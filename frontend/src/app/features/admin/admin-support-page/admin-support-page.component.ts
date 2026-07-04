import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SupportRequest } from '../../../core/models/domain.models';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';

type StatusFilter = '' | 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

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
    return ({ FEEDBACK: 'Feedback', BUG: 'Bug', FEATURE_REQUEST: 'Feature', QUESTION: 'Dúvida', OTHER: 'Outro' } as Record<string, string>)[type] ?? type;
  }

  protected dateLabel(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  private load() {
    this.loading.set(true);
    this.api
      .listAdminSupportRequests({ status: this.filterStatus() || undefined, page: this.page() })
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
}
