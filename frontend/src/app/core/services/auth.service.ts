import { computed, inject, Injectable, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import {
  catchError,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  tap,
  throwError,
} from "rxjs";
import { environment } from "../../../environments/environment";
import { AuthResponse, User } from "../models/domain.models";
import { NetworkService } from "./network.service";

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly networkService = inject(NetworkService);
  private readonly storage = globalThis.localStorage;
  private readonly accessTokenKey = "lumen.accessToken";
  private readonly refreshTokenKey = "lumen.refreshToken";
  private readonly userKey = "lumen.user";

  private readonly accessTokenSignal = signal<string | null>(
    this.storage.getItem(this.accessTokenKey),
  );
  private readonly refreshTokenSignal = signal<string | null>(
    this.storage.getItem(this.refreshTokenKey),
  );
  private readonly userSignal = signal<User | null>(this.readStoredUser());
  private restoreRequest$?: Observable<boolean>;

  readonly currentUser = computed(() => this.userSignal());
  readonly isAuthenticated = computed(() => !!this.accessTokenSignal());
  readonly hasSession = computed(
    () => !!this.accessTokenSignal() || !!this.refreshTokenSignal(),
  );
  readonly canUseOfflineSession = computed(
    () => !!this.userSignal() && this.hasSession(),
  );

  login(payload: { email: string; password: string }) {
    return this.http
      .post<AuthResponse>(`${environment.apiBaseUrl}/auth/login`, payload)
      .pipe(tap((response) => this.setSession(response)));
  }

  register(payload: {
    name: string;
    email: string;
    password: string;
    avatarUrl?: string;
    privacyNoticeAccepted: boolean;
    aiAssistantEnabled?: boolean;
    monthlyIncome?: number;
    monthClosingDay?: number;
    timezone?: string;
    preferredCurrency?: string;
  }) {
    return this.http
      .post<AuthResponse>(`${environment.apiBaseUrl}/auth/register`, payload)
      .pipe(tap((response) => this.setSession(response)));
  }

  loadMe() {
    if (!this.networkService.isOnline()) {
      return of(this.userSignal()).pipe(
        map((user) => user as User),
      );
    }

    return this.http.get<User>(`${environment.apiBaseUrl}/auth/me`).pipe(
      tap((user) => {
        this.userSignal.set(user);
        this.storage.setItem(this.userKey, JSON.stringify(user));
      }),
      catchError((error) => {
        if (!this.networkService.isOnline() && this.userSignal()) {
          return of(this.userSignal() as User);
        }

        return throwError(() => error);
      }),
    );
  }

  restoreSession(force = false) {
    if (!this.networkService.isOnline() && this.canUseOfflineSession()) {
      return of(true);
    }

    if (!this.refreshTokenSignal()) {
      return of(false);
    }

    if (!force && this.accessTokenSignal()) {
      return of(true);
    }

    if (this.restoreRequest$) {
      return this.restoreRequest$;
    }

    this.restoreRequest$ = this.http
      .post<AuthResponse>(`${environment.apiBaseUrl}/auth/refresh`, {
        refreshToken: this.refreshTokenSignal(),
      })
      .pipe(
        tap((response) => this.setSession(response)),
        map(() => true),
        catchError((error) => {
          if (!this.networkService.isOnline() && this.canUseOfflineSession()) {
            return of(true);
          }

          this.clearSession();
          return of(false);
        }),
        finalize(() => {
          this.restoreRequest$ = undefined;
        }),
        shareReplay(1),
      );

    return this.restoreRequest$;
  }

  updateStoredUser(user: User) {
    this.userSignal.set(user);
    this.storage.setItem(this.userKey, JSON.stringify(user));
  }

  getAccessToken() {
    return this.accessTokenSignal();
  }

  logout() {
    this.clearSession();
    this.router.navigate(["/auth/login"]);
  }

  clearSession() {
    this.storage.removeItem(this.accessTokenKey);
    this.storage.removeItem(this.refreshTokenKey);
    this.storage.removeItem(this.userKey);
    this.accessTokenSignal.set(null);
    this.refreshTokenSignal.set(null);
    this.userSignal.set(null);
  }

  private setSession(response: AuthResponse) {
    this.accessTokenSignal.set(response.accessToken);
    this.refreshTokenSignal.set(response.refreshToken);
    this.userSignal.set(response.user);
    this.storage.setItem(this.accessTokenKey, response.accessToken);
    this.storage.setItem(this.refreshTokenKey, response.refreshToken);
    this.storage.setItem(this.userKey, JSON.stringify(response.user));
  }

  private readStoredUser() {
    const rawUser = this.storage.getItem(this.userKey);

    if (!rawUser) {
      return null;
    }

    try {
      return JSON.parse(rawUser) as User;
    } catch {
      return null;
    }
  }
}
