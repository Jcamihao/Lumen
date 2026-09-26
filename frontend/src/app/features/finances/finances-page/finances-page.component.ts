import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Envelope, PaymentMethod, Transaction } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatLocalDateLabel, todayLocalInputValue } from '../../../core/utils/date.utils';
import { BudgetRow, buildBudgetRows } from '../../../core/utils/budget.utils';
import { focusField } from '../../../core/utils/focus.utils';
import { paymentMethodLabel } from '../../../core/utils/payment-method.utils';
import { buildSpendingBreakdown } from '../../../core/utils/spending.utils';
import { PaymentMethodPickerComponent } from '../../../shared/payment-method-picker/payment-method-picker.component';
import { SpendingBreakdownComponent } from '../../../shared/spending-breakdown/spending-breakdown.component';
import { CreditCycleCardComponent } from '../credit-cycle-card/credit-cycle-card.component';
import { EnvelopesCardComponent } from '../envelopes-card/envelopes-card.component';
import { InstallmentPurchasesCardComponent } from '../installment-purchases-card/installment-purchases-card.component';
import { RecurringTransactionsCardComponent } from '../recurring-transactions-card/recurring-transactions-card.component';

/** Mesma logica de rotacao de cor das Reservas: uma cor por posicao, sem seletor manual. */
const CATEGORY_COLORS = ['#f18f01', '#006cd2', '#0f9d7a', '#7c5cff', '#ef4444', '#0ea5e9'];

@Component({
  selector: 'app-finances-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    SpendingBreakdownComponent,
    PaymentMethodPickerComponent,
    CreditCycleCardComponent,
    EnvelopesCardComponent,
    RecurringTransactionsCardComponent,
    InstallmentPurchasesCardComponent,
  ],
  templateUrl: './finances-page.component.html',
  styleUrls: ['./finances-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinancesPageComponent {
  @ViewChild(EnvelopesCardComponent) private envelopesCardRef?: EnvelopesCardComponent;

  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  private readonly now = new Date();
  protected readonly filterMonth = signal(this.now.getMonth() + 1);
  protected readonly filterYear = signal(this.now.getFullYear());
  protected readonly filterType = signal<'' | 'INCOME' | 'EXPENSE' | 'TRANSFER'>('');
  protected readonly filterPaymentMethod = signal<'' | PaymentMethod>('');
  protected readonly filterEnvelopeId = signal('');
  protected readonly envelopes = signal<Envelope[]>([]);
  protected readonly filterSearch = signal('');

  protected readonly transactions = signal<Transaction[]>([]);
  // Despesas do mes selecionado para a rosca: independe do filtro de tipo e da
  // busca da lista, senao filtrar "Receitas" esvaziaria o grafico.
  private readonly spendingTransactions = signal<Transaction[]>([]);
  private spendingRequestId = 0;
  // Sobe quando algo fora da pagina (contas fixas) gera ou apaga lancamentos:
  // os dois effects abaixo leem este sinal e recarregam.
  private readonly reloadTick = signal(0);
  protected readonly spendingBreakdown = computed(() =>
    buildSpendingBreakdown(this.spendingTransactions()),
  );
  protected readonly financeCategories = computed(
    () => this.authService.currentUser()?.financeCategories ?? [],
  );
  protected readonly budgetRows = computed(() =>
    buildBudgetRows(this.financeCategories(), this.spendingTransactions()),
  );
  protected readonly editingBudgetId = signal<string | null>(null);
  protected readonly savingBudget = signal(false);
  // type=number entrega number (ou null quando vazio), nao string.
  protected readonly budgetControl = new FormControl<number | null>(null);
  protected readonly categoryFormOpen = signal(false);
  protected readonly savingCategory = signal(false);
  protected readonly busyCategoryId = signal<string | null>(null);
  protected readonly categoryNameControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(2)],
  });
  protected readonly currencyCode = computed(
    () => this.authService.currentUser()?.preferredCurrency ?? 'BRL',
  );
  protected readonly incomeTotal = computed(
    () => this.transactions().filter((item) => item.type === 'INCOME').reduce((sum, item) => sum + item.amount, 0),
  );
  protected readonly expenseTotal = computed(
    () => this.transactions().filter((item) => item.type !== 'INCOME').reduce((sum, item) => sum + item.amount, 0),
  );
  protected readonly netFlow = computed(
    () => this.incomeTotal() - this.expenseTotal(),
  );

  protected readonly monthLabel = computed(() => {
    const d = new Date(this.filterYear(), this.filterMonth() - 1, 1);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  });

  protected readonly form = this.fb.nonNullable.group({
    description: ['', [Validators.required, Validators.minLength(2)]],
    type: ['EXPENSE'],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    date: [todayLocalInputValue(), Validators.required],
    categoryId: [''],
    // '' = nao informado.
    paymentMethod: ['' as PaymentMethod | ''],
    envelopeId: [''],
  });

  constructor() {
    this.refreshEnvelopes();
    effect(() => {
      this.reloadTick();
      const month = this.filterMonth();
      const year = this.filterYear();
      const type = this.filterType();
      const paymentMethod = this.filterPaymentMethod();
      const envelopeId = this.filterEnvelopeId();
      const search = this.filterSearch().trim();

      if (search) {
        this.loadTransactions({
          type: type || undefined,
          paymentMethod: paymentMethod || undefined,
          envelopeId: envelopeId || undefined,
          search,
        });
      } else {
        this.loadTransactions({
          month,
          year,
          type: type || undefined,
          paymentMethod: paymentMethod || undefined,
          envelopeId: envelopeId || undefined,
        });
      }
    });

    effect(() => {
      this.reloadTick();
      this.loadSpending(this.filterMonth(), this.filterYear());
    });

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const search = params.get('search')?.trim();
        if (search) {
          this.filterSearch.set(search);
        }
      });
  }

  protected previousMonth() {
    const m = this.filterMonth();
    const y = this.filterYear();
    if (m === 1) {
      this.filterMonth.set(12);
      this.filterYear.set(y - 1);
    } else {
      this.filterMonth.set(m - 1);
    }
  }

  protected nextMonth() {
    const m = this.filterMonth();
    const y = this.filterYear();
    if (m === 12) {
      this.filterMonth.set(1);
      this.filterYear.set(y + 1);
    } else {
      this.filterMonth.set(m + 1);
    }
  }

  protected paymentLabel(transaction: Transaction) {
    return paymentMethodLabel(transaction.paymentMethod);
  }

  protected refreshEnvelopes() {
    this.api
      .listEnvelopes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((envelopes) => this.envelopes.set(envelopes));
  }

  protected focusNewTransaction() {
    focusField('transaction-description');
  }

  protected refreshAfterRecurringChange() {
    this.reloadTick.update((tick) => tick + 1);
  }

  protected startEditBudget(row: BudgetRow) {
    this.budgetControl.setValue(row.budget);
    this.editingBudgetId.set(row.id);
  }

  protected cancelEditBudget() {
    this.editingBudgetId.set(null);
  }

  protected saveBudget(row: BudgetRow) {
    const value = this.budgetControl.value;

    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      this.toast.error('Informe um valor maior que zero.');
      return;
    }

    this.persistBudget(row, Math.round(value * 100) / 100, 'Orçamento salvo.');
  }

  protected removeBudget(row: BudgetRow) {
    this.persistBudget(row, null, 'Orçamento removido.');
  }

  protected budgetStatusText(row: BudgetRow) {
    const remaining = row.remaining ?? 0;

    if (row.status === 'over') {
      return `Passou ${this.formatMoney(Math.abs(remaining))} do orçamento (${row.percentLabel}%)`;
    }

    return `${row.percentLabel}% usado · restam ${this.formatMoney(remaining)}`;
  }

  protected formatMoney(value: number) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: this.currencyCode(),
    }).format(value);
  }

  protected trackBudgetRow(_index: number, row: BudgetRow) {
    return row.id;
  }

  protected isCurrentMonth() {
    const n = new Date();
    return this.filterMonth() === n.getMonth() + 1 && this.filterYear() === n.getFullYear();
  }

  protected createTransaction() {
    const raw = this.form.getRawValue();
    this.api
      .createTransaction({
        description: raw.description,
        type: raw.type,
        amount: raw.amount,
        date: raw.date,
        categoryId: raw.categoryId || undefined,
        paymentMethod: raw.paymentMethod || undefined,
        envelopeId: raw.envelopeId || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (transaction) => {
          this.form.patchValue({ description: '', amount: 0, categoryId: '', paymentMethod: '', envelopeId: '' });
          this.upsertTransaction(transaction);
          this.loadSpending(this.filterMonth(), this.filterYear());
          // A transacao pode ter sido marcada com um envelope: atualiza o saldo dele.
          this.envelopesCardRef?.refresh();
          this.toast.success('Transação registrada.');
        },
        error: () => this.toast.error('Não foi possível registrar a transação.'),
      });
  }

  protected removeTransaction(id: string) {
    if (!globalThis.confirm('Deseja excluir esta transação? Essa ação não pode ser desfeita.')) {
      return;
    }

    this.api
      .deleteTransaction(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.transactions.update((current) =>
            current.filter((transaction) => transaction.id !== id),
          );
          this.loadSpending(this.filterMonth(), this.filterYear());
          // A transacao removida podia estar marcada com um envelope.
          this.envelopesCardRef?.refresh();
          this.toast.success('Transação removida.');
        },
        error: () => this.toast.error('Não foi possível remover a transação.'),
      });
  }

  protected transactionAmount(transaction: Transaction) {
    const formatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: this.currencyCode(),
    }).format(transaction.amount);

    if (transaction.type === 'TRANSFER') {
      return formatted;
    }

    return `${transaction.type === 'INCOME' ? '+' : '-'} ${formatted}`;
  }

  protected typeLabel(type: Transaction['type'] | '') {
    if (!type) return 'Todos os tipos';
    return {
      INCOME: 'Receita',
      EXPENSE: 'Despesa',
      TRANSFER: 'Transferência',
    }[type];
  }

  protected transactionDateLabel(transaction: Transaction) {
    return formatLocalDateLabel(transaction.date);
  }

  protected transactionTypeTone(transaction: Transaction) {
    if (transaction.type === 'INCOME') {
      return 'success' as const;
    }

    if (transaction.type === 'EXPENSE') {
      return 'danger' as const;
    }

    return 'accent' as const;
  }

  private loadTransactions(params: {
    month?: number;
    year?: number;
    type?: string;
    search?: string;
    paymentMethod?: string;
    envelopeId?: string;
  }) {
    this.api
      .listTransactions(params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((transactions) => this.transactions.set(transactions));
  }

  private persistBudget(row: BudgetRow, monthlyBudget: number | null, successMessage: string) {
    this.savingBudget.set(true);

    this.api
      .updateFinanceCategory(row.id, { monthlyBudget })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // As categorias do usuario vem do perfil: recarrega para a barra atualizar.
          this.authService.loadMe().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
          this.savingBudget.set(false);
          this.editingBudgetId.set(null);
          this.toast.success(successMessage);
        },
        error: () => {
          this.savingBudget.set(false);
          this.toast.error('Não foi possível salvar o orçamento agora.');
        },
      });
  }

  protected openCategoryForm() {
    this.categoryFormOpen.set(true);
  }

  protected cancelCategoryForm() {
    this.categoryFormOpen.set(false);
    this.categoryNameControl.reset('');
  }

  protected createCategory() {
    if (this.categoryNameControl.invalid || this.savingCategory()) {
      this.categoryNameControl.markAsTouched();
      return;
    }

    // So categorias de despesa aparecem neste card (orcamento so vale pra despesa);
    // a cor gira pela mesma paleta das Reservas, sem seletor manual.
    const expenseCount = this.financeCategories().filter((c) => c.type === 'EXPENSE').length;
    const color = CATEGORY_COLORS[expenseCount % CATEGORY_COLORS.length];

    this.savingCategory.set(true);

    this.api
      .createFinanceCategory({
        name: this.categoryNameControl.value.trim(),
        color,
        type: 'EXPENSE',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.authService.loadMe().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
          this.savingCategory.set(false);
          this.cancelCategoryForm();
          this.toast.success('Categoria criada.');
        },
        error: (error) => {
          this.savingCategory.set(false);
          this.toast.error(this.categoryErrorMessage(error, 'Não foi possível criar a categoria agora.'));
        },
      });
  }

  protected removeCategory(row: BudgetRow) {
    if (
      !globalThis.confirm(
        `Excluir a categoria "${row.name}"? Os lançamentos já feitos com ela ficam sem categoria.`,
      )
    ) {
      return;
    }

    this.busyCategoryId.set(row.id);

    this.api
      .deleteFinanceCategory(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.authService.loadMe().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
          this.busyCategoryId.set(null);
          this.toast.success('Categoria excluída.');
        },
        error: () => {
          this.busyCategoryId.set(null);
          this.toast.error('Não foi possível excluir a categoria agora.');
        },
      });
  }

  private categoryErrorMessage(error: any, fallback: string) {
    const message = error?.error?.message;

    if (error?.status === 400 && typeof message === 'string') {
      return message;
    }

    if (error?.status === 400 && Array.isArray(message) && message.length) {
      return String(message[0]);
    }

    return fallback;
  }

  private loadSpending(month: number, year: number) {
    const requestId = ++this.spendingRequestId;

    this.api
      .listTransactions({ month, year, type: 'EXPENSE' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((transactions) => {
        // Ignora resposta atrasada de um mes que o usuario ja deixou pra tras.
        if (requestId === this.spendingRequestId) {
          this.spendingTransactions.set(transactions);
        }
      });
  }

  private upsertTransaction(transaction: Transaction | null) {
    if (!transaction) {
      return;
    }

    this.transactions.update((current) => {
      const existingIndex = current.findIndex((item) => item.id === transaction.id);

      if (existingIndex === -1) {
        return this.sortTransactions([transaction, ...current]);
      }

      const next = [...current];
      next[existingIndex] = transaction;
      return this.sortTransactions(next);
    });
  }

  private sortTransactions(transactions: Transaction[]) {
    return [...transactions].sort(
      (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
    );
  }
}
