import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { BillingMe, GrantView, PublicPlan } from '../models/domain.models';

@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly http = inject(HttpClient);

  private readonly enabledSignal = signal(false);
  private readonly meSignal = signal<BillingMe | null>(null);

  readonly enabled = computed(() => this.enabledSignal());
  readonly me = computed(() => this.meSignal());

  loadPlans(): Observable<{ enabled: boolean; plans: PublicPlan[] }> {
    return this.http
      .get<{ enabled: boolean; plans: PublicPlan[] }>(`${environment.apiBaseUrl}/billing/plans`)
      .pipe(tap((response) => this.enabledSignal.set(response.enabled)));
  }

  loadMe(): Observable<BillingMe> {
    return this.http
      .get<BillingMe>(`${environment.apiBaseUrl}/billing/me`)
      .pipe(tap((me) => this.meSignal.set(me)));
  }

  listGrants(): Observable<GrantView[]> {
    return this.http.get<GrantView[]>(`${environment.apiBaseUrl}/billing/admin/grants`);
  }

  createGrant(body: { email: string; plan: 'INDIVIDUAL'; endsAt?: string }): Observable<GrantView> {
    return this.http.post<GrantView>(`${environment.apiBaseUrl}/billing/admin/grants`, body);
  }

  revokeGrant(id: string): Observable<GrantView> {
    return this.http.delete<GrantView>(`${environment.apiBaseUrl}/billing/admin/grants/${id}`);
  }

  checkout(body: { plan: 'INDIVIDUAL'; interval: 'MONTHLY' | 'YEARLY' }): Observable<{ link: string }> {
    return this.http.post<{ link: string }>(`${environment.apiBaseUrl}/billing/checkout`, body);
  }

  cancel(): Observable<void> {
    return this.http.post<void>(`${environment.apiBaseUrl}/billing/cancel`, null);
  }

  sync(): Observable<void> {
    return this.http.post<void>(`${environment.apiBaseUrl}/billing/sync`, null);
  }
}
