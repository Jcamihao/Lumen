import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Transaction } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatLocalDateLabel, todayLocalInputValue } from '../../../core/utils/date.utils';

@Component({
  selector: 'app-finances-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './finances-page.component.html',
  styleUrls: ['./finances-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinancesPageComponent {
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
  protected readonly filterSearch = signal('');

  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly financeCategories = computed(
    () => this.authService.currentUser()?.financeCategories ?? [],
  );
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
  });

  constructor() {
    effect(() => {
      const month = this.filterMonth();
      const year = this.filterYear();
      const type = this.filterType();
      const search = this.filterSearch().trim();

      if (search) {
        this.loadTransactions({ type: type || undefined, search });
      } else {
        this.loadTransactions({ month, year, type: type || undefined });
      }
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
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (transaction) => {
          this.form.patchValue({ description: '', amount: 0, categoryId: '' });
          this.upsertTransaction(transaction);
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
          this.toast.success('Transação removida.');
        },
        error: () => this.toast.error('Não foi possível remover a transação.'),
      });
  }

  protected transactionAmount(transaction: Transaction) {
    const formatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: this.currencyCode(),
      maximumFractionDigits: 0,
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

  private loadTransactions(params: { month?: number; year?: number; type?: string; search?: string }) {
    this.api
      .listTransactions(params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((transactions) => this.transactions.set(transactions));
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
