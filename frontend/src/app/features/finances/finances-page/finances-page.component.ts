import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Transaction } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { formatLocalDateLabel, todayLocalInputValue } from '../../../core/utils/date.utils';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { FieldShellComponent } from '../../../shared/components/field-shell/field-shell.component';
import { ListItemComponent } from '../../../shared/components/list-item/list-item.component';
import { MetricCardComponent } from '../../../shared/components/metric-card/metric-card.component';
import { PanelComponent } from '../../../shared/components/panel/panel.component';
import { UiBadgeComponent } from '../../../shared/components/ui-badge/ui-badge.component';
import { UiButtonComponent } from '../../../shared/components/ui-button/ui-button.component';

@Component({
  selector: 'app-finances-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CurrencyPipe,
    DatePipe,
    RouterLink,
    PanelComponent,
    EmptyStateComponent,
    FieldShellComponent,
    UiButtonComponent,
    UiBadgeComponent,
    ListItemComponent,
    MetricCardComponent,
  ],
  templateUrl: './finances-page.component.html',
  styleUrls: ['./finances-page.component.scss'],
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
      .subscribe(() => {
        this.form.patchValue({
          description: '',
          amount: 0,
          categoryId: '',
        });
        this.reload();
      });
  }

  protected removeTransaction(id: string) {
    this.api
      .deleteTransaction(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());
  }

  protected transactionSubtitle(transaction: Transaction) {
    return `${transaction.category?.name || 'Sem categoria'} · ${formatLocalDateLabel(transaction.date)}`;
  }

  protected transactionAmount(transaction: Transaction) {
    const formatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: this.currencyCode(),
      maximumFractionDigits: 0,
    }).format(transaction.amount);

    return `${transaction.type === 'INCOME' ? '+' : '-'} ${formatted}`;
  }

  protected typeLabel(type: Transaction['type']) {
    return {
      INCOME: 'Receita',
      EXPENSE: 'Despesa',
      TRANSFER: 'Transferência',
    }[type];
  }

  private reload() {
    this.api
      .listTransactions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((transactions) => this.transactions.set(transactions));
  }
}
