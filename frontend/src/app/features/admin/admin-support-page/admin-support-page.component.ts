import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FeedbackSummary, SupportRequest } from '../../../core/models/domain.models';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { RATING_OPTIONS, areaLabel } from '../../../core/utils/feedback.utils';

type StatusFilter = '' | 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';
type TypeFilter = '' | 'FEEDBACK' | 'BUG_REPORT';

@Component({
  selector: 'app-admin-support-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-support-page.component.html',
  styleUrls: ['./admin-support-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSupportPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly requests = signal<SupportRequest[]>([]);
  protected readonly loading = signal(true);
  protected readonly filterStatus = signal<StatusFilter>('');
  protected readonly filterType = signal<TypeFilter>('');
  protected readonly summary = signal<FeedbackSummary | null>(null);
  protected readonly ratingScale = [...RATING_OPTIONS].reverse();
  protected readonly page = signal(1);
  protected readonly updatingId = signal<string | null>(null);
  protected readonly expandedId = signal<string | null>(null);

  protected readonly filtered = computed(() => {
    const status = this.filterStatus();
    return status
      ? this.requests().filter((r) => r.status === status)
      : this.requests();
  });

  constructor() {
    this.load();
    this.loadSummary();
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
}
