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
  switchMap,
  take,
  tap,
  throwError,
} from "rxjs";
import { environment } from "../../../environments/environment";
import {
  AuthResponse,
  LoginResult,
  MfaConfirmResponse,
  MfaDisableResponse,
  MfaSetupResponse,
  User,
} from "../models/domain.models";
import { NetworkService } from "./network.service";
import { NativeStorageService } from "./native-storage.service";

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly networkService = inject(NetworkService);
  private readonly storage = inject(NativeStorageService);
  private readonly accessTokenKey = "lumen.accessToken";
  private readonly refreshTokenKey = "lumen.refreshToken";
  private readonly userKey = "lumen.user";
  private readonly usesRefreshCookie = !this.storage.isNativePlatform();

  private readonly accessTokenSignal = signal<string | null>(
    this.storage.getSessionItem(this.accessTokenKey),
  );
  private readonly refreshTokenSignal = signal<string | null>(
    this.storage.getSessionItem(this.refreshTokenKey),
  );
  private readonly userSignal = signal<User | null>(this.readStoredUser());
  private restoreRequest$?: Observable<boolean>;

  readonly currentUser = computed(() => this.userSignal());
  readonly isAuthenticated = computed(() => !!this.accessTokenSignal());
  readonly hasSession = computed(
    () =>
      !!this.accessTokenSignal() ||
      !!this.refreshTokenSignal() ||
      this.usesRefreshCookie,
  );
  readonly canUseOfflineSession = computed(
    () =>
      !!this.userSignal() &&
      (!!this.accessTokenSignal() || !!this.refreshTokenSignal()),
  );

  login(payload: { email: string; password: string }) {
    return this.http
      .post<LoginResult>(`${environment.apiBaseUrl}/auth/login`, payload)
      .pipe(tap((response) => this.setSessionFromLoginResult(response)));
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

  verifyLoginMfa(payload: { challengeId: string; code: string }) {
    return this.http
      .post<AuthResponse>(`${environment.apiBaseUrl}/auth/mfa/verify-login`, payload)
      .pipe(tap((response) => this.setSession(response)));
  }

  startMfaSetup() {
    return this.http.post<MfaSetupResponse>(`${environment.apiBaseUrl}/auth/mfa/setup`, {});
  }

  confirmMfaSetup(payload: { code: string }) {
    return this.http
      .post<MfaConfirmResponse>(`${environment.apiBaseUrl}/auth/mfa/confirm-setup`, payload)
      .pipe(
        tap((response) => {
          this.updateStoredUser(response.user);
        }),
      );
  }

  regenerateMfaRecoveryCodes(payload: { code: string }) {
    return this.http
      .post<MfaConfirmResponse>(
        `${environment.apiBaseUrl}/auth/mfa/recovery-codes/regenerate`,
        payload,
      )
      .pipe(
        tap((response) => {
          this.updateStoredUser(response.user);
        }),
      );
  }

  disableMfa(payload: { code: string }) {
    return this.http
      .post<MfaDisableResponse>(`${environment.apiBaseUrl}/auth/mfa/disable`, payload)
      .pipe(
        tap((response) => {
          this.updateStoredUser(response.user);
        }),
      );
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

    if (!this.networkService.isOnline()) {
      return of(false);
    }

    if (!this.refreshTokenSignal() && !this.usesRefreshCookie) {
      return of(false);
    }

    if (!force && this.accessTokenSignal()) {
      return of(true);
    }

    if (this.restoreRequest$) {
      return this.restoreRequest$;
    }

    this.restoreRequest$ = this.http
      .post<AuthResponse>(`${environment.apiBaseUrl}/auth/refresh`, this.buildRefreshPayload())
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
    this.runLogoutRequest("logout");
  }

  logoutAllDevices() {
    this.runLogoutRequest("logout-all");
  }

  clearSession() {
    this.storage.removeSessionItem(this.accessTokenKey);
    this.storage.removeSessionItem(this.refreshTokenKey);
    this.storage.removeItem(this.userKey);
    this.accessTokenSignal.set(null);
    this.refreshTokenSignal.set(null);
    this.userSignal.set(null);
  }

  private runLogoutRequest(path: "logout" | "logout-all") {
    const accessToken = this.accessTokenSignal();
    const shouldRefreshBeforeLogout =
      this.usesRefreshCookie || (!accessToken && !!this.refreshTokenSignal());

    if (!this.networkService.isOnline()) {
      this.clearSession();
      void this.router.navigate(["/auth/login"]);
      return;
    }

    const logoutRequest$ = shouldRefreshBeforeLogout
      ? this.restoreSession(true).pipe(
          take(1),
          switchMap((authenticated) =>
            authenticated
              ? this.http.post(`${environment.apiBaseUrl}/auth/${path}`, {})
              : of(null),
          ),
        )
      : accessToken
        ? this.http.post(`${environment.apiBaseUrl}/auth/${path}`, {})
        : of(null);

    logoutRequest$
      .pipe(
        catchError(() => of(null)),
        finalize(() => {
          this.clearSession();
          void this.router.navigate(["/auth/login"]);
        }),
      )
      .subscribe();
  }

  private setSession(response: AuthResponse) {
    this.accessTokenSignal.set(response.accessToken);
    const refreshToken = this.usesRefreshCookie
      ? null
      : (response.refreshToken ?? null);
    this.refreshTokenSignal.set(refreshToken);
    this.userSignal.set(response.user);
    this.storage.setSessionItem(this.accessTokenKey, response.accessToken);
    if (refreshToken) {
      this.storage.setSessionItem(this.refreshTokenKey, refreshToken);
    } else {
      this.storage.removeSessionItem(this.refreshTokenKey);
    }
    this.storage.setItem(this.userKey, JSON.stringify(response.user));
  }

  private setSessionFromLoginResult(response: LoginResult) {
    if (this.isAuthResponse(response)) {
      this.setSession(response);
    }
  }

  private isAuthResponse(response: LoginResult): response is AuthResponse {
    return "accessToken" in response;
  }

  private buildRefreshPayload() {
    if (this.usesRefreshCookie) {
      return {};
    }

    return {
      refreshToken: this.refreshTokenSignal(),
    };
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
