import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { CreditCycle } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatDayLabel } from '../../../core/utils/date.utils';

/**
 * Configuracoes do cartao de credito: fechamento, vencimento, teto do ciclo
 * e o escopo do teto (so credito vs. tambem debito/PIX). Fase 1 da
 * reorganizacao (opcao D): esta pagina duplica o que ja existe no card
 * "Teto de crédito" de Finanças e em Configurações — nada foi removido de
 * la ainda, so criado aqui pra validar antes de esvaziar os lugares antigos.
 */
@Component({
    selector: 'app-card-page',
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './card-page.component.html',
    styleUrls: ['./card-page.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CardPageComponent {
  private readonly api = inject(LifeApiService);
  protected readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly cycle = signal<CreditCycle | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly saving = signal(false);
  protected readonly savingClosingDay = signal(false);

  protected readonly closingDayControl = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(1),
    Validators.max(31),
  ]);
  protected readonly dueDayControl = new FormControl<number | null>(null, [
    Validators.min(1),
    Validators.max(31),
  ]);
  protected readonly ceilingControl = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(0.01),
  ]);

  protected readonly currencyCode = () => this.authService.currentUser()?.preferredCurrency ?? 'BRL';

  constructor() {
    this.closingDayControl.setValue(this.authService.currentUser()?.monthClosingDay ?? null);
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
          this.dueDayControl.setValue(cycle.dueDay);
          this.ceilingControl.setValue(cycle.ceiling ?? cycle.previousCeiling ?? null);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadFailed.set(true);
        },
      });
  }

  protected saveClosingDay() {
    if (this.closingDayControl.invalid || this.savingClosingDay()) {
      this.closingDayControl.markAsTouched();
      return;
    }

    this.savingClosingDay.set(true);

    this.api
      .updateUser({ monthClosingDay: Number(this.closingDayControl.value) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (user) => {
          this.authService.updateStoredUser(user);
          this.savingClosingDay.set(false);
          this.toast.success('Dia de fechamento salvo.');
          this.load();
        },
        error: () => {
          this.savingClosingDay.set(false);
          this.toast.error('Não foi possível salvar o fechamento agora.');
        },
      });
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
          this.toast.success('Vencimento salvo.');
        },
        error: () => {
          this.saving.set(false);
          this.toast.error('Não foi possível salvar o vencimento agora.');
        },
      });
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
          this.toast.success('Teto do ciclo salvo.');
        },
        error: () => {
          this.saving.set(false);
          this.toast.error('Não foi possível salvar o teto agora.');
        },
      });
  }

  protected toggleCountAllPayments() {
    const current = this.cycle();
    if (!current || this.saving()) return;

    const next = !current.countAllPayments;
    this.saving.set(true);

    this.api
      .updateCreditCycleSettings({ countAllPayments: next })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cycle) => {
          this.cycle.set(cycle);
          this.saving.set(false);
          this.toast.success(
            next ? 'Agora o teto soma crédito, débito e PIX.' : 'Agora o teto soma só o crédito.',
          );
        },
        error: () => {
          this.saving.set(false);
          this.toast.error('Não foi possível salvar agora.');
        },
      });
  }

  protected cycleRangeLabel(cycle: CreditCycle) {
    return `${formatDayLabel(cycle.cycleStart, { day: '2-digit', month: 'short' })} a ${formatDayLabel(cycle.cycleEnd, { day: '2-digit', month: 'short' })}`;
  }

  protected statusText(cycle: CreditCycle) {
    if (cycle.status === 'none') {
      return 'Nenhum teto definido pra este ciclo ainda.';
    }
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
