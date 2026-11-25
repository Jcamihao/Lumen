import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { switchMap } from 'rxjs';
import {
  BillingMe,
  CreatedGroupInvite,
  GroupView,
  LimitedResource,
} from '../../../core/models/domain.models';
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
  creditCards: 'Cartões',
};

const RESOURCE_ORDER: LimitedResource[] = [
  'goals',
  'envelopes',
  'recurringTransactions',
  'installmentPurchases',
  'creditCards',
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
    if (me.plan === 'SHARED' && me.group?.role === 'member') {
      // Membro ve so o primeiro nome do pagador (D10) — nada de cobranca alheia.
      const first = me.group.ownerFirstName;
      return first ? `Plano Compartilhado de ${first}` : 'Plano Compartilhado';
    }
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

  // --- Grupo do plano Compartilhado (contrato 11, 11a-2) ---

  protected readonly group = signal<GroupView | null>(null);
  protected readonly createdInvite = signal<CreatedGroupInvite | null>(null);
  protected readonly copyMessage = signal<string | null>(null);
  protected readonly groupBusy = signal(false);

  /** Titulo do cartao-resumo: membro ve "Plano Compartilhado de <primeiro nome>" (D10). */
  protected readonly groupTitle = computed(() => {
    const me = this.billing.me();
    if (me?.group?.role === 'member') {
      const first = me.group.ownerFirstName;
      return first ? `Você usa o plano de ${first}` : 'Você usa o plano de outra pessoa';
    }
    return 'Membros';
  });

  /** Convidado chega por /plano?convite=<token>: aceite pelo backend (e-mail tem que bater). */
  protected acceptedInviteToast = false;

  constructor() {
    // GET /billing/me responde mesmo com BILLING_ENABLED desligado (usage "sem limite");
    // a tela decide o que mostrar pelo enabled() do BillingService, nao pela resposta em si.
    this.billing
      .loadMe()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (me) => {
          if (me?.group) this.loadGroup();
        },
      });

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
        return;
      }

      const convite = params['convite'];
      if (convite && !this.acceptedInviteToast) {
        this.acceptedInviteToast = true;
        this.billing
          .acceptGroupInvite(convite)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (view) => {
              const first = view.role === 'member' ? view.ownerFirstName : null;
              this.toast.success(first ? `Você entrou no grupo de ${first}.` : 'Você entrou no grupo.');
              this.billing
                .loadMe()
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                  next: (me) => {
                    if (me?.group) this.loadGroup();
                  },
                });
            },
            // Mensagem do backend e uniforme p/ convite invalido (D12) — usa ela quando existir.
            error: (error: unknown) =>
              this.toast.error(this.serverMessage(error) ?? 'Não foi possível aceitar este convite.'),
          });
      }
    });
  }

  /** Chama checkout no BillingService e, com o link devolvido, navega pra pagina hospedada do Asaas. */
  protected subscribe(plan: 'INDIVIDUAL' | 'SHARED', interval: 'MONTHLY' | 'YEARLY') {
    this.billing
      .checkout({ plan, interval })
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

  // --- Grupo do plano Compartilhado (contrato 11, 11a-2) ---

  /** GET /billing/group (404 = sem grupo; silencioso: a tela so mostra o bloco com sucesso). */
  protected loadGroup() {
    this.billing
      .loadGroup()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (view) => this.group.set(view),
        error: () => this.group.set(null),
      });
  }

  /** Link de convite: o mesmo /plano com ?convite= (o backend exige logado com o e-mail do convite). */
  protected inviteLink(token: string) {
    return `${window.location.origin}/plano?convite=${token}`;
  }

  protected inviteMember(email: string) {
    const trimmed = email.trim();
    if (!trimmed || this.groupBusy()) return;
    this.groupBusy.set(true);
    this.billing
      .createGroupInvite(trimmed)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (invite) => {
          this.createdInvite.set(invite);
          this.copyMessage.set(null);
          this.groupBusy.set(false);
          this.loadGroup();
        },
        error: (error: unknown) => {
          this.groupBusy.set(false);
          this.toast.error(
            this.serverMessage(error) ?? 'Não foi possível convidar. Confira o e-mail e o seu plano.',
          );
        },
      });
  }

  protected async copyInviteLink() {
    const invite = this.createdInvite();
    if (!invite) return;
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard) {
      this.copyMessage.set('Copie manualmente o link acima.');
      return;
    }
    try {
      await clipboard.writeText(this.inviteLink(invite.token));
      this.copyMessage.set('Link copiado.');
    } catch {
      this.copyMessage.set('Copie manualmente o link acima.');
    }
  }

  protected revokeInvite(id: string) {
    this.billing
      .revokeGroupInvite(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadGroup(),
        error: () => this.toast.error('Não foi possível revogar o convite.'),
      });
  }

  /** Remover membro e sair do grupo pedem confirmacao (padrao de duas etapas do app). */
  protected removeMember(id: string, email: string) {
    if (!window.confirm(`Remover ${email} do grupo? A pessoa volta para o plano Grátis.`)) return;
    this.billing
      .removeGroupMember(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadGroup(),
        error: () => this.toast.error('Não foi possível remover o membro.'),
      });
  }

  protected leaveGroup() {
    if (
      !window.confirm(
        'Sair do grupo? Você volta para o plano Grátis e pode ser convidado de novo depois.',
      )
    ) {
      return;
    }
    this.billing
      .leaveGroup()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.group.set(null);
          this.toast.show('Você saiu do grupo.', 'info');
          this.billing
            .loadMe()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe();
        },
        error: () => this.toast.error('Não foi possível sair do grupo.'),
      });
  }

  protected memberSinceLabel() {
    const view = this.group();
    return view && view.role === 'member' ? formatDayLabel(view.joinedAt) : '';
  }

  protected dayLabel(iso: string) {
    return formatDayLabel(iso);
  }

  /** Mensagem vinda do backend quando existir (o 404 de convite invalido e uniforme la, D12). */
  private serverMessage(error: unknown): string | null {
    const message = (error as { error?: { message?: unknown } })?.error?.message;
    return typeof message === 'string' && message ? message : null;
  }
}
