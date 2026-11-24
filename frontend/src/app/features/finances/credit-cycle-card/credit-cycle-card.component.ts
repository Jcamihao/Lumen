import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { CreditCycle, CreditCard } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { activeCards } from '../../../core/utils/credit-card.utils';
import { formatDayLabel } from '../../../core/utils/date.utils';
import { formatCurrency } from '../../../core/utils/money.utils';

/**
 * "Quanto ainda posso gastar no crédito", por ciclo de fechamento (nao pelo
 * mes do calendario). So mostra o número/barra glanceable; toda edição
 * (fechamento, vencimento, teto, escopo) mora na página /card desde a
 * reorganização "Cartão" (opção D, fase 2).
 */
@Component({
    selector: 'app-credit-cycle-card',
    imports: [CommonModule, RouterLink],
    templateUrl: './credit-cycle-card.component.html',
    styleUrls: ['./credit-cycle-card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CreditCycleCardComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly cycle = signal<CreditCycle | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly cards = signal<CreditCard[]>([]);
  protected readonly selectedCardId = signal<string | null>(null);
  /** Com dois ou mais cartoes ativos aparecem abas; com um, o card segue igual ao de antes. */
  protected readonly showTabs = computed(() => this.cards().length >= 2);
  private requestId = 0;

  protected readonly currencyCode = () => this.authService.currentUser()?.preferredCurrency ?? 'BRL';

  constructor() {
    this.loadCards();
  }

  protected load() {
    const requestId = ++this.requestId;
    this.loading.set(true);
    this.loadFailed.set(false);

    this.cycleRequest()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cycle) => {
          if (requestId !== this.requestId) return;
          this.cycle.set(cycle);
          this.loading.set(false);
        },
        error: () => {
          if (requestId !== this.requestId) return;
          this.loading.set(false);
          this.loadFailed.set(true);
        },
      });
  }

  protected selectCard(id: string) {
    if (id === this.selectedCardId()) return;

    this.selectedCardId.set(id);
    this.load();
  }

  private loadCards() {
    this.api
      .listCreditCards()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cards) => this.setCards(cards),
        error: () => this.setCards([]),
      });
  }

  private setCards(cards: CreditCard[]) {
    const active = activeCards(cards);
    const selected = this.selectedCardId();

    this.cards.set(active);
    if (!active.some((card) => card.id === selected)) {
      this.selectedCardId.set(active[0]?.id ?? null);
    }
    this.load();
  }

  private cycleRequest(): Observable<CreditCycle> {
    const cardId = this.selectedCardId();

    return this.showTabs() && cardId
      ? this.api.getCreditCardCycle(cardId)
      : this.api.getCurrentCreditCycle();
  }

  protected cycleRangeLabel(cycle: CreditCycle) {
    return `${formatDayLabel(cycle.cycleStart, { day: '2-digit', month: 'short' })} a ${formatDayLabel(cycle.cycleEnd, { day: '2-digit', month: 'short' })}`;
  }

  protected statusText(cycle: CreditCycle) {
    if (cycle.status === 'over') {
      return `Passou ${this.formatMoney(Math.abs(cycle.remaining ?? 0))} do teto (${cycle.percentUsed}%)`;
    }

    return `${cycle.percentUsed}% usado · restam ${this.formatMoney(cycle.remaining ?? 0)}`;
  }

  protected formatMoney(value: number) {
    return formatCurrency(value, this.currencyCode());
  }
}
