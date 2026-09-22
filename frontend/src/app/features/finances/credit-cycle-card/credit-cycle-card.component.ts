import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CreditCycle } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatDayLabel } from '../../../core/utils/date.utils';

/**
 * "Quanto ainda posso gastar no crédito", por ciclo de fechamento (nao pelo
 * mes do calendario). O dia de fechamento reaproveita monthClosingDay do
 * usuario (editavel em Configuracoes); aqui so o dia de vencimento e o teto.
 */
@Component({
  selector: 'app-credit-cycle-card',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './credit-cycle-card.component.html',
  styleUrls: ['./credit-cycle-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreditCycleCardComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly cycle = signal<CreditCycle | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly editingCeiling = signal(false);
  protected readonly editingDueDay = signal(false);
  protected readonly saving = signal(false);

  protected readonly ceilingControl = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(0.01),
  ]);
  protected readonly dueDayControl = new FormControl<number | null>(null, [
    Validators.min(1),
    Validators.max(31),
  ]);

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

  protected startEditCeiling() {
    const current = this.cycle();
    this.ceilingControl.setValue(current?.ceiling ?? current?.previousCeiling ?? null);
    this.editingCeiling.set(true);
  }

  protected cancelEditCeiling() {
    this.editingCeiling.set(false);
  }

  protected saveCeiling() {
    if (this.ceilingControl.invalid || this.saving()) {
      this.ceilingControl.markAsTouched();
      return;
    }

    this.saving.set(true);

    this.api
      .setCreditCycleCeiling({ ceiling: Number(this.ceilingControl.value) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cycle) => {
          this.cycle.set(cycle);
          this.saving.set(false);
          this.editingCeiling.set(false);
          this.toast.success('Teto do crédito salvo.');
        },
        error: () => {
          this.saving.set(false);
          this.toast.error('Não foi possível salvar o teto agora.');
        },
      });
  }

  protected startEditDueDay() {
    this.dueDayControl.setValue(this.cycle()?.dueDay ?? null);
    this.editingDueDay.set(true);
  }

  protected cancelEditDueDay() {
    this.editingDueDay.set(false);
  }

  protected saveDueDay() {
    if (this.dueDayControl.invalid || this.saving()) {
      this.dueDayControl.markAsTouched();
      return;
    }

    this.saving.set(true);
    const raw = this.dueDayControl.value;

    this.api
      .updateCreditCycleSettings({ dueDay: raw === null || raw === undefined ? null : Number(raw) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cycle) => {
          this.cycle.set(cycle);
          this.saving.set(false);
          this.editingDueDay.set(false);
          this.toast.success('Vencimento salvo.');
        },
        error: () => {
          this.saving.set(false);
          this.toast.error('Não foi possível salvar o vencimento agora.');
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
