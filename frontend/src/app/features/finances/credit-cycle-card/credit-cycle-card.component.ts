import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CreditCycle } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { formatDayLabel } from '../../../core/utils/date.utils';

/**
 * "Quanto ainda posso gastar no crédito", por ciclo de fechamento (nao pelo
 * mes do calendario). So mostra o número/barra glanceable; toda edição
 * (fechamento, vencimento, teto, escopo) mora na página /card desde a
 * reorganização "Cartão" (opção D, fase 2).
 */
@Component({
  selector: 'app-credit-cycle-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './credit-cycle-card.component.html',
  styleUrls: ['./credit-cycle-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreditCycleCardComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly cycle = signal<CreditCycle | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);

  protected readonly currencyCode = () => this.authService.currentUser()?.preferredCurrency ?? 'BRL';

  constructor() {
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.loadFailed.set(false);

    this.api
      .getCurrentCreditCycle()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cycle) => {
          this.cycle.set(cycle);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadFailed.set(true);
        },
      });
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
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: this.currencyCode(),
    }).format(value);
  }
}
