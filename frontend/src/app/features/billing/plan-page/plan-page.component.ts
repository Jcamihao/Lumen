import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BillingMe, LimitedResource } from '../../../core/models/domain.models';
import { BillingService } from '../../../core/services/billing.service';
import { formatDayLabel } from '../../../core/utils/date.utils';

type UsageRow = {
  key: LimitedResource;
  label: string;
  used: number;
  limit: number | null;
};

const RESOURCE_LABELS: Record<LimitedResource, string> = {
  goals: 'Metas',
  envelopes: 'Reservas',
  recurringTransactions: 'Contas fixas',
  installmentPurchases: 'Compras parceladas',
};

const RESOURCE_ORDER: LimitedResource[] = [
  'goals',
  'envelopes',
  'recurringTransactions',
  'installmentPurchases',
];

const PLAN_LABELS: Record<BillingMe['plan'], string> = {
  FREE: 'Grátis',
  INDIVIDUAL: 'Individual',
  SHARED: 'Compartilhado',
};

@Component({
  selector: 'app-plan-page',
  imports: [CommonModule],
  templateUrl: './plan-page.component.html',
  styleUrls: ['./plan-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanPageComponent {
  protected readonly billing = inject(BillingService);
  private readonly destroyRef = inject(DestroyRef);

  /** "Plano Individual" ou, se concedido pelo dono, "Plano Individual — concedido pelo Lumen". */
  protected readonly planTitle = computed(() => {
    const me = this.billing.me();
    if (!me) return '';
    const label = `Plano ${PLAN_LABELS[me.plan]}`;
    return me.source === 'GRANT' ? `${label} — concedido pelo Lumen` : label;
  });

  protected readonly usageRows = computed<UsageRow[]>(() => {
    const me = this.billing.me();
    if (!me) return [];
    return RESOURCE_ORDER.map((key) => ({
      key,
      label: RESOURCE_LABELS[key],
      used: me.usage.resources[key].used,
      limit: me.usage.resources[key].limit,
    }));
  });

  constructor() {
    // GET /billing/me responde mesmo com BILLING_ENABLED desligado (usage "sem limite");
    // a tela decide o que mostrar pelo enabled() do BillingService, nao pela resposta em si.
    this.billing
      .loadMe()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  protected progressPercent(used: number, limit: number | null) {
    if (limit === null || limit === 0) return 0;
    return Math.min(Math.round((used / limit) * 100), 100);
  }

  protected progressTone(used: number, limit: number | null) {
    if (limit === null) return 'accent' as const;
    if (used >= limit) return 'danger' as const;
    if (used / limit >= 0.8) return 'warning' as const;
    return 'accent' as const;
  }

  protected statusLabel(): string | null {
    const me = this.billing.me();
    if (!me) return null;
    switch (me.status) {
      case 'PAST_DUE':
        return 'Pagamento em atraso';
      case 'CANCELED':
        return me.cancelAtPeriodEnd ? 'Cancelamento agendado' : 'Cancelado';
      case 'EXPIRED':
        return 'Expirado';
      default:
        return null;
    }
  }

  protected periodEndLabel() {
    const me = this.billing.me();
    return me?.currentPeriodEnd ? formatDayLabel(me.currentPeriodEnd) : '';
  }

  protected selahResetLabel() {
    const me = this.billing.me();
    return me ? formatDayLabel(me.usage.selahQuestions.resetsAt) : '';
  }
}
