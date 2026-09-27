import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { FeedbackSummary, GrantView, SubscriptionStatus, SupportRequest } from '../../../core/models/domain.models';
import { BillingService } from '../../../core/services/billing.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatDayLabel } from '../../../core/utils/date.utils';
import { RATING_OPTIONS, areaLabel } from '../../../core/utils/feedback.utils';

type StatusFilter = '' | 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';
type TypeFilter = '' | 'FEEDBACK' | 'BUG_REPORT';

const GRANT_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  PENDING: 'Pendente',
  ACTIVE: 'Ativo',
  PAST_DUE: 'Em atraso',
  CANCELED: 'Cancelado',
  EXPIRED: 'Expirado',
};

const GRANT_STATUS_TONES: Record<SubscriptionStatus, string> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  CANCELED: 'neutral',
  EXPIRED: 'neutral',
};

const GRANT_PLAN_LABELS: Record<GrantView['plan'], string> = {
  INDIVIDUAL: 'Individual',
  SHARED: 'Compartilhado',
};

@Component({
    selector: 'app-admin-support-page',
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './admin-support-page.component.html',
    styleUrls: ['./admin-support-page.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminSupportPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly billing = inject(BillingService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  protected readonly requests = signal<SupportRequest[]>([]);
  protected readonly loading = signal(true);
  protected readonly filterStatus = signal<StatusFilter>('');
  protected readonly filterType = signal<TypeFilter>('');
  protected readonly summary = signal<FeedbackSummary | null>(null);
  protected readonly ratingScale = [...RATING_OPTIONS].reverse();
  protected readonly page = signal(1);
  protected readonly updatingId = signal<string | null>(null);
  protected readonly expandedId = signal<string | null>(null);

  protected readonly grants = signal<GrantView[]>([]);
  protected readonly loadingGrants = signal(true);
  protected readonly grantSaving = signal(false);
  protected readonly revokingId = signal<string | null>(null);

  protected readonly grantForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    endsAt: [''],
  });

  protected readonly filtered = computed(() => {
    const status = this.filterStatus();
    return status
      ? this.requests().filter((r) => r.status === status)
      : this.requests();
  });

  constructor() {
    this.load();
    this.loadSummary();
    this.loadGrants();
  }

  protected selectType(type: TypeFilter) {
    this.filterType.set(type);
    this.page.set(1);
    this.load();
  }

  /** Largura da barra da distribuicao de notas (0-100), relativa a nota mais comum. */
  protected distributionWidth(rating: number) {
    const distribution = this.summary()?.distribution;
    if (!distribution) return 0;

    const max = Math.max(...Object.values(distribution), 1);
    return Math.round((distribution[rating as 1 | 2 | 3 | 4 | 5] / max) * 100);
  }

  protected distributionCount(rating: number) {
    return this.summary()?.distribution[rating as 1 | 2 | 3 | 4 | 5] ?? 0;
  }

  protected areaText(area: string | null | undefined) {
    return areaLabel(area);
  }

  protected selectStatus(status: StatusFilter) {
    this.filterStatus.set(status);
    this.page.set(1);
    this.load();
  }

  protected toggleExpand(id: string) {
    this.expandedId.update((current) => (current === id ? null : id));
  }

  protected isExpanded(id: string) {
    return this.expandedId() === id;
  }

  protected nextPage() {
    this.page.update((p) => p + 1);
    this.load();
  }

  protected prevPage() {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this.load();
  }

  protected updateStatus(id: string, status: string) {
    this.updatingId.set(id);
    this.api
      .updateSupportRequestStatus(id, status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.updatingId.set(null);
          this.requests.update((current) =>
            current.map((r) => (r.id === id ? { ...r, status: updated.status as SupportRequest['status'], updatedAt: updated.updatedAt } : r)),
          );
          this.toast.success('Status atualizado.');
        },
        error: () => {
          this.updatingId.set(null);
          this.toast.error('Não foi possível atualizar o status.');
        },
      });
  }

  protected statusLabel(status: string) {
    return ({ OPEN: 'Aberto', IN_REVIEW: 'Em análise', RESOLVED: 'Resolvido', CLOSED: 'Fechado' } as Record<string, string>)[status] ?? status;
  }

  protected statusTone(status: string) {
    return ({ OPEN: 'warning', IN_REVIEW: 'accent', RESOLVED: 'success', CLOSED: 'neutral' } as Record<string, string>)[status] ?? 'neutral';
  }

  protected severityLabel(severity: string | null) {
    if (!severity) return '—';
    return ({ LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', CRITICAL: 'Crítica' } as Record<string, string>)[severity] ?? severity;
  }

  protected typeLabel(type: string) {
    return ({ FEEDBACK: 'Feedback', BUG_REPORT: 'Bug', BUG: 'Bug', FEATURE_REQUEST: 'Feature', QUESTION: 'Dúvida', OTHER: 'Outro' } as Record<string, string>)[type] ?? type;
  }

  protected dateLabel(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  private load() {
    this.loading.set(true);
    this.api
      .listAdminSupportRequests({
        status: this.filterStatus() || undefined,
        type: this.filterType() || undefined,
        page: this.page(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.requests.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast.error('Não foi possível carregar as solicitações.');
        },
      });
  }

  private loadSummary() {
    this.api
      .getFeedbackSummary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => this.summary.set(summary),
        // O resumo e um extra: se falhar, a lista continua funcionando.
        error: () => this.summary.set(null),
      });
  }

  protected trackGrant(_index: number, grant: GrantView) {
    return grant.id;
  }

  protected grantPlanLabel(plan: GrantView['plan']) {
    return GRANT_PLAN_LABELS[plan] ?? plan;
  }

  protected grantStatusLabel(status: SubscriptionStatus) {
    return GRANT_STATUS_LABELS[status] ?? status;
  }

  protected grantStatusTone(status: SubscriptionStatus) {
    return GRANT_STATUS_TONES[status] ?? 'neutral';
  }

  protected grantEndsLabel(grant: GrantView) {
    return grant.currentPeriodEnd ? formatDayLabel(grant.currentPeriodEnd) : 'sem fim';
  }

  protected submitGrant() {
    if (this.grantForm.invalid || this.grantSaving()) {
      this.grantForm.markAllAsTouched();
      return;
    }

    const raw = this.grantForm.getRawValue();
    this.grantSaving.set(true);

    this.billing
      .createGrant({
        email: raw.email.trim(),
        plan: 'INDIVIDUAL',
        endsAt: raw.endsAt || undefined,
      })
      .pipe(
        finalize(() => this.grantSaving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (grant) => {
          this.grants.update((current) => [grant, ...current]);
          this.grantForm.reset({ email: '', endsAt: '' });
          this.toast.success('Plano concedido.');
        },
        error: (error) =>
          this.toast.error(error?.error?.message ?? 'Não foi possível conceder o plano.'),
      });
  }

  protected revokeGrant(grant: GrantView) {
    if (this.revokingId()) return;

    this.revokingId.set(grant.id);
    this.billing
      .revokeGrant(grant.id)
      .pipe(
        finalize(() => this.revokingId.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updated) => {
          this.grants.update((current) => current.map((g) => (g.id === updated.id ? updated : g)));
          this.toast.success('Concessão revogada.');
        },
        error: (error) =>
          this.toast.error(error?.error?.message ?? 'Não foi possível revogar a concessão.'),
      });
  }

  private loadGrants() {
    this.loadingGrants.set(true);
    this.billing
      .listGrants()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (grants) => {
          this.grants.set(grants);
          this.loadingGrants.set(false);
        },
        error: () => {
          this.loadingGrants.set(false);
          this.toast.error('Não foi possível carregar as concessões de plano.');
        },
      });
  }
}
