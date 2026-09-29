import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { switchMap } from 'rxjs';
import { BillingMe, LimitedResource } from '../../../core/models/domain.models';
import { BillingService } from '../../../core/services/billing.service';
import { ToastService } from '../../../core/services/toast.service';
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
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  /** Preenchido logo apos o retorno do checkout hospedado, enquanto sync()+loadMe() confirmam o pagamento. */
  protected readonly confirmingCheckout = signal(false);

  /** "Plano Individual" ou, se concedido pelo dono, "Plano Individual — concedido pelo Lumen". */
  protected readonly planTitle = computed(() => {
    const me = this.billing.me();
    if (!me) return '';
    const label = `Plano ${PLAN_LABELS[me.plan]}`;
    return me.source === 'GRANT' ? `${label} — concedido pelo Lumen` : label;
  });

  /** So quem tem assinatura de verdade no Asaas (nao concessao) pode cancelar por aqui, e so faz sentido em ACTIVE/PAST_DUE. */
  protected readonly showCancelButton = computed(() => {
    const me = this.billing.me();
    return !!me && me.source === 'ASAAS' && (me.status === 'ACTIVE' || me.status === 'PAST_DUE');
  });

  protected readonly cancelButtonLabel = computed(() =>
    this.billing.me()?.status === 'PAST_DUE' ? 'Cancelar e assinar de novo' : 'Cancelar',
  );

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

    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const checkout = params['checkout'];
      if (checkout === 'sucesso') {
        this.confirmingCheckout.set(true);
        this.billing
          .sync()
          .pipe(
            switchMap(() => this.billing.loadMe()),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe({
            next: () => this.confirmingCheckout.set(false),
            error: () => this.confirmingCheckout.set(false),
          });
      } else if (checkout === 'cancelado') {
        this.toast.show('Checkout cancelado. Você pode assinar quando quiser.', 'info');
      } else if (checkout === 'expirado') {
        this.toast.show('O link de checkout expirou. Tente assinar de novo.', 'info');
      }
    });
  }

  /** Chama checkout no BillingService e, com o link devolvido, navega pra pagina hospedada do Asaas. */
  protected subscribe(interval: 'MONTHLY' | 'YEARLY') {
    this.billing
      .checkout({ plan: 'INDIVIDUAL', interval })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ link }) => this.navigateToExternal(link),
        error: () => this.toast.error('Não foi possível iniciar o checkout. Tente novamente.'),
      });
  }

  protected cancelSubscription() {
    if (!window.confirm('Cancelar sua assinatura? Você continua com acesso até o fim do período já pago.')) {
      return;
    }
    this.billing
      .cancel()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.billing.loadMe().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(),
        error: () => this.toast.error('Não foi possível cancelar a assinatura. Tente novamente.'),
      });
  }

  /** Isola window.location.href num metodo pra dar pra espionar em teste (nao da pra espionar a propriedade direto). */
  protected navigateToExternal(url: string) {
    window.location.href = url;
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
