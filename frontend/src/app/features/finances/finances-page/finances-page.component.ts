import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Transaction } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
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
  protected readonly incomeCount = computed(
    () => this.transactions().filter((item) => item.type === 'INCOME').length,
  );
  protected readonly expenseCount = computed(
    () => this.transactions().filter((item) => item.type !== 'INCOME').length,
  );

  protected readonly form = this.fb.nonNullable.group({
    description: ['', [Validators.required, Validators.minLength(2)]],
    type: ['EXPENSE'],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    date: [todayLocalInputValue(), Validators.required],
    categoryId: [''],
  });

  constructor() {
    this.reload();
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
      .subscribe((transaction) => {
        this.form.patchValue({
          description: '',
          amount: 0,
          categoryId: '',
        });
        this.upsertTransaction(transaction);
      });
  }

  protected removeTransaction(id: string) {
    this.api
      .deleteTransaction(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.transactions.update((current) =>
          current.filter((transaction) => transaction.id !== id),
        );
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

  protected typeLabel(type: Transaction['type']) {
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

  private reload() {
    this.api
      .listTransactions()
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
