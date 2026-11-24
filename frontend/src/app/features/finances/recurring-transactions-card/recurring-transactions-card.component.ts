import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PaymentMethod, RecurrenceFrequency, RecurringTransaction } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { todayLocalInputValue } from '../../../core/utils/date.utils';
import { readErrorMessage } from '../../../core/utils/http-error.utils';
import { cardIdForPayload, isCreditExpense } from '../../../core/utils/credit-card.utils';
import { formatCurrency } from '../../../core/utils/money.utils';
import { paymentMethodLabel } from '../../../core/utils/payment-method.utils';
import { readPlanLimitAction, readPlanLimitMessage } from '../../../core/utils/plan-limit.utils';
import { CreditCardSelectComponent } from '../../../shared/credit-card-select/credit-card-select.component';
import { PaymentMethodPickerComponent } from '../../../shared/payment-method-picker/payment-method-picker.component';
import {
  daysUntilDue,
  dueDateLabel,
  recurrenceLabel,
  recurringStatus,
} from '../../../core/utils/recurrence.utils';

@Component({
    selector: 'app-recurring-transactions-card',
    imports: [CommonModule, ReactiveFormsModule, PaymentMethodPickerComponent, CreditCardSelectComponent],
    templateUrl: './recurring-transactions-card.component.html',
    styleUrls: ['./recurring-transactions-card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RecurringTransactionsCardComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  /** Avisa a pagina quando algo criou/removeu lancamentos, para ela recarregar a lista. */
  @Output() readonly changed = new EventEmitter<void>();

  protected readonly items = signal<RecurringTransaction[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly busyId = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    type: ['EXPENSE' as 'EXPENSE' | 'INCOME'],
    description: ['', [Validators.required, Validators.minLength(2)]],
    // type=number entrega number (ou null se o campo for limpo).
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    categoryId: [''],
    paymentMethod: ['' as PaymentMethod | ''],
    cardId: [''],
    frequency: ['MONTHLY' as RecurrenceFrequency],
    firstDueDate: [todayLocalInputValue(), Validators.required],
    endDate: [''],
  });

  private readonly selectedType = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value,
  });

  protected readonly currencyCode = computed(
    () => this.authService.currentUser()?.preferredCurrency ?? 'BRL',
  );
  protected readonly categories = computed(() =>
    (this.authService.currentUser()?.financeCategories ?? []).filter(
      (category) => category.type === this.selectedType(),
    ),
  );

  constructor() {
    // Trocar de despesa para receita invalida a categoria escolhida.
    this.form.controls.type.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.form.controls.categoryId.setValue(''));

    this.load();
  }

  protected openForm() {
    this.formOpen.set(true);
  }

  protected closeForm() {
    this.formOpen.set(false);
    this.form.reset({
      type: 'EXPENSE',
      description: '',
      amount: null,
      categoryId: '',
      paymentMethod: '',
      cardId: '',
      frequency: 'MONTHLY',
      firstDueDate: todayLocalInputValue(),
      endDate: '',
    });
  }

  protected submit() {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();

    if (raw.endDate && raw.endDate < raw.firstDueDate) {
      this.toast.error('A data final não pode ser anterior ao primeiro vencimento.');
      return;
    }

    this.saving.set(true);

    this.api
      .createRecurringTransaction({
        type: raw.type,
        description: raw.description.trim(),
        amount: Number(raw.amount),
        categoryId: raw.categoryId || undefined,
        paymentMethod: raw.paymentMethod || undefined,
        cardId: cardIdForPayload(raw.cardId, isCreditExpense(raw.type, raw.paymentMethod)),
        frequency: raw.frequency,
        firstDueDate: raw.firstDueDate,
        endDate: raw.endDate || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.closeForm();
          this.toast.success('Conta fixa criada.');
          this.load();
          this.changed.emit();
        },
        error: (error) => {
          this.saving.set(false);
          const message =
            readPlanLimitMessage(error) ?? readErrorMessage(error, 'Não foi possível criar a conta fixa.');
          const action = readPlanLimitAction(error);
          if (action) {
            this.toast.errorWithAction(message, action);
          } else {
            this.toast.error(message);
          }
        },
      });
  }

  protected togglePause(item: RecurringTransaction) {
    this.busyId.set(item.id);

    this.api
      .updateRecurringTransaction(item.id, { isActive: !item.isActive })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.toast.success(item.isActive ? 'Conta pausada.' : 'Conta retomada.');
          this.load();
          this.changed.emit();
        },
        error: (error) => {
          this.busyId.set(null);
          const message =
            readPlanLimitMessage(error) ?? readErrorMessage(error, 'Não foi possível atualizar a conta.');
          const action = readPlanLimitAction(error);
          if (action) {
            this.toast.errorWithAction(message, action);
          } else {
            this.toast.error(message);
          }
        },
      });
  }

  protected remove(item: RecurringTransaction) {
    if (
      !globalThis.confirm(
        `Excluir "${item.description}"? Os lançamentos já gerados continuam na sua lista.`,
      )
    ) {
      return;
    }

    this.busyId.set(item.id);

    this.api
      .deleteRecurringTransaction(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.toast.success('Conta fixa removida.');
          this.load();
          this.changed.emit();
        },
        error: () => {
          this.busyId.set(null);
          this.toast.error('Não foi possível remover a conta.');
        },
      });
  }

  protected load() {
    this.api
      .listRecurringTransactions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.items.set(items);
          this.loading.set(false);
          this.loadFailed.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadFailed.set(true);
        },
      });
  }

  protected status(item: RecurringTransaction) {
    return recurringStatus(item);
  }

  protected frequencyText(item: RecurringTransaction) {
    return recurrenceLabel(item);
  }

  protected paymentText(item: RecurringTransaction) {
    return [paymentMethodLabel(item.paymentMethod), item.cardName].filter(Boolean).join(' · ') || null;
  }

  protected creditExpenseSelected() {
    const raw = this.form.getRawValue();
    return isCreditExpense(raw.type, raw.paymentMethod);
  }

  protected nextText(item: RecurringTransaction) {
    const status = recurringStatus(item);

    if (status === 'paused') {
      return 'Pausada';
    }

    if (status === 'ended') {
      return 'Encerrada';
    }

    const days = daysUntilDue(item.nextDueDate);
    const date = `Próximo: ${dueDateLabel(item.nextDueDate)}`;

    if (days === 1) return `${date} · amanhã`;
    if (days > 1 && days <= 3) return `${date} · em ${days} dias`;
    return date;
  }

  protected amountText(item: RecurringTransaction) {
    const formatted = formatCurrency(item.amount, this.currencyCode());

    return `${item.type === 'INCOME' ? '+' : '-'} ${formatted}`;
  }

  protected trackItem(_index: number, item: RecurringTransaction) {
    return item.id;
  }
}
