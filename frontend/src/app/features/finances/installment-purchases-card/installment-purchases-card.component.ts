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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { InstallmentPurchase, PaymentMethod } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatDayLabel, todayLocalInputValue } from '../../../core/utils/date.utils';
import { readErrorMessage } from '../../../core/utils/http-error.utils';
import { cardIdForPayload } from '../../../core/utils/credit-card.utils';
import { formatCurrency } from '../../../core/utils/money.utils';
import { paymentMethodLabel } from '../../../core/utils/payment-method.utils';
import { readPlanLimitAction, readPlanLimitMessage } from '../../../core/utils/plan-limit.utils';
import { CreditCardSelectComponent } from '../../../shared/credit-card-select/credit-card-select.component';
import { PaymentMethodPickerComponent } from '../../../shared/payment-method-picker/payment-method-picker.component';

@Component({
    selector: 'app-installment-purchases-card',
    imports: [CommonModule, ReactiveFormsModule, PaymentMethodPickerComponent, CreditCardSelectComponent],
    templateUrl: './installment-purchases-card.component.html',
    styleUrls: ['./installment-purchases-card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class InstallmentPurchasesCardComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  /** Avisa a pagina quando algo criou/removeu parcelas, para ela recarregar a lista. */
  @Output() readonly changed = new EventEmitter<void>();

  protected readonly items = signal<InstallmentPurchase[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly busyId = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    description: ['', [Validators.required, Validators.minLength(2)]],
    // type=number entrega number (ou null se o campo for limpo).
    totalAmount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    installmentsTotal: [2 as number | null, [Validators.required, Validators.min(2), Validators.max(60)]],
    categoryId: [''],
    paymentMethod: ['' as PaymentMethod | ''],
    cardId: [''],
    firstDueDate: [todayLocalInputValue(), Validators.required],
  });

  protected readonly currencyCode = computed(
    () => this.authService.currentUser()?.preferredCurrency ?? 'BRL',
  );
  protected readonly categories = computed(() =>
    (this.authService.currentUser()?.financeCategories ?? []).filter(
      (category) => category.type === 'EXPENSE',
    ),
  );

  constructor() {
    this.load();
  }

  protected openForm() {
    this.formOpen.set(true);
  }

  protected closeForm() {
    this.formOpen.set(false);
    this.form.reset({
      description: '',
      totalAmount: null,
      installmentsTotal: 2,
      categoryId: '',
      paymentMethod: '',
      cardId: '',
      firstDueDate: todayLocalInputValue(),
    });
  }

  protected submit() {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    this.saving.set(true);

    this.api
      .createInstallmentPurchase({
        description: raw.description.trim(),
        totalAmount: Number(raw.totalAmount),
        installmentsTotal: Number(raw.installmentsTotal),
        categoryId: raw.categoryId || undefined,
        paymentMethod: raw.paymentMethod || undefined,
        cardId: cardIdForPayload(raw.cardId, raw.paymentMethod === 'CREDIT'),
        firstDueDate: raw.firstDueDate || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.closeForm();
          this.toast.success('Compra parcelada registrada.');
          this.load();
          this.changed.emit();
        },
        error: (error) => {
          this.saving.set(false);
          const message =
            readPlanLimitMessage(error) ??
            readErrorMessage(error, 'Não foi possível registrar a compra parcelada.');
          const action = readPlanLimitAction(error);
          if (action) {
            this.toast.errorWithAction(message, action);
          } else {
            this.toast.error(message);
          }
        },
      });
  }

  protected remove(item: InstallmentPurchase) {
    if (
      !globalThis.confirm(
        `Cancelar "${item.description}"? As parcelas já geradas continuam na sua lista.`,
      )
    ) {
      return;
    }

    this.busyId.set(item.id);

    this.api
      .deleteInstallmentPurchase(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.toast.success('Compra parcelada cancelada.');
          this.load();
          this.changed.emit();
        },
        error: () => {
          this.busyId.set(null);
          this.toast.error('Não foi possível cancelar agora.');
        },
      });
  }

  protected load() {
    this.api
      .listInstallmentPurchases()
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

  protected progressText(item: InstallmentPurchase) {
    if (item.remainingInstallments === 0) {
      return 'Todas as parcelas pagas';
    }

    return `${item.installmentsGenerated}/${item.installmentsTotal} pagas · restam ${this.money(item.remainingAmount)}`;
  }

  protected nextText(item: InstallmentPurchase) {
    if (!item.nextDueDate) {
      return 'Encerrada';
    }

    return `Próxima: ${formatDayLabel(item.nextDueDate, { day: '2-digit', month: 'short' })}`;
  }

  protected paymentText(item: InstallmentPurchase) {
    return [paymentMethodLabel(item.paymentMethod), item.cardName].filter(Boolean).join(' · ') || null;
  }

  protected money(value: number) {
    return formatCurrency(value, this.currencyCode());
  }

  protected trackItem(_index: number, item: InstallmentPurchase) {
    return item.id;
  }
}
