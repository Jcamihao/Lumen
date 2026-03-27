import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Transaction } from '../../core/models/domain.models';
import { AuthService } from '../../core/services/auth.service';
import { LifeApiService } from '../../core/services/life-api.service';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { FieldShellComponent } from '../../shared/components/field-shell.component';
import { ListItemComponent } from '../../shared/components/list-item.component';
import { MetricCardComponent } from '../../shared/components/metric-card.component';
import { PanelComponent } from '../../shared/components/panel.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge.component';
import { UiButtonComponent } from '../../shared/components/ui-button.component';

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
  template: `
    <div class="page-stack">
      <section class="metrics">
        <app-metric-card
          label="Receitas"
          [value]="incomeTotal()"
          [currency]="true"
          [currencyCode]="currencyCode()"
          caption="Entradas registradas"
          tone="success"
        />
        <app-metric-card
          label="Despesas"
          [value]="expenseTotal()"
          [currency]="true"
          [currencyCode]="currencyCode()"
          caption="Saídas monitoradas"
          tone="warning"
        />
        <app-metric-card
          label="Saldo líquido"
          [value]="netFlow()"
          [currency]="true"
          [currencyCode]="currencyCode()"
          caption="Diferença entre entradas e saídas"
          [tone]="netFlow() >= 0 ? 'success' : 'danger'"
        />
      </section>

      <section class="split-layout finance-layout">
        <div class="page-stack">
          <app-panel class="composer-panel" title="Nova transação" caption="Registre dinheiro com contexto de vida">
            <form class="form-grid" [formGroup]="form" (ngSubmit)="createTransaction()">
              <app-field-shell label="Descrição" hint="Obrigatório">
                <input type="text" formControlName="description" placeholder="Ex.: Conta de luz">
              </app-field-shell>

              <div class="grid-2">
                <app-field-shell label="Tipo">
                  <select formControlName="type">
                    <option value="EXPENSE">Despesa</option>
                    <option value="INCOME">Receita</option>
                    <option value="TRANSFER">Transferência</option>
                  </select>
                </app-field-shell>

                <app-field-shell label="Valor">
                  <input type="number" formControlName="amount" placeholder="0">
                </app-field-shell>
              </div>

              <div class="grid-2">
                <app-field-shell label="Data">
                  <input type="date" formControlName="date">
                </app-field-shell>

                <app-field-shell label="Categoria">
                  <select formControlName="categoryId">
                    <option value="">Sem categoria</option>
                    <option *ngFor="let category of financeCategories()" [value]="category.id">
                      {{ category.name }} · {{ category.type }}
                    </option>
                  </select>
                </app-field-shell>
              </div>

              <div class="surface-note finance-note">
                <div>
                  <strong>Importação inteligente</strong>
                  <p>Traga movimentações em lote com preview e deduplicação.</p>
                </div>
                <app-ui-button variant="secondary" routerLink="/imports" size="sm">
                  Importar CSV
                </app-ui-button>
              </div>

              <app-ui-button type="submit" [disabled]="form.invalid" [fullWidth]="true" icon="payments">
                Salvar transação
              </app-ui-button>
            </form>
          </app-panel>
        </div>

        <app-panel class="feed-panel" title="Movimentos" caption="Receitas, despesas e transferências recentes">
          <div class="toolbar">
            <app-ui-badge [label]="transactions().length + ' registros'" tone="accent" />
            <app-ui-badge [label]="incomeCount() + ' receitas'" tone="success" />
            <app-ui-badge [label]="expenseCount() + ' saídas'" tone="warning" />
          </div>

          <div class="stack-list" *ngIf="transactions().length; else emptyState">
            <app-list-item
              *ngFor="let transaction of transactions()"
              [title]="transaction.description"
              [subtitle]="transactionSubtitle(transaction)"
              [meta]="transactionAmount(transaction)"
              [metaTone]="transaction.type === 'INCOME' ? 'positive' : 'negative'"
              [badge]="typeLabel(transaction.type)"
              [badgeTone]="transaction.type === 'INCOME' ? 'success' : transaction.type === 'EXPENSE' ? 'warning' : 'neutral'"
              [avatar]="transaction.description"
            >
              <div list-actions class="row-actions">
                <app-ui-button variant="ghost" size="sm" (click)="removeTransaction(transaction.id)">
                  Excluir
                </app-ui-button>
              </div>
            </app-list-item>
          </div>

          <ng-template #emptyState>
            <app-empty-state
              title="Nenhuma transação registrada"
              description="Adicione receitas ou despesas para destravar previsões e insights."
              icon="account_balance_wallet"
            />
          </ng-template>
        </app-panel>
      </section>
    </div>
  `,
  styles: [`
    .metrics,
    .form-grid,
    .stack-list {
      display: grid;
      gap: 1rem;
    }

    .grid-2 {
      display: grid;
      gap: 0.9rem;
    }

    .toolbar,
    .row-actions,
    .finance-note {
      display: flex;
      gap: 0.65rem;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
    }

    .finance-note p {
      margin: 0.25rem 0 0;
      color: var(--text-medium);
      font-size: 0.9rem;
    }

    @media (min-width: 860px) {
      .finance-layout {
        align-items: start;
      }

      .metrics {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .finance-layout {
        grid-template-columns: 420px minmax(0, 1fr);
      }

      .grid-2 {
        grid-template-columns: 1fr 1fr;
      }

      .composer-panel {
        position: sticky;
        top: 6.5rem;
      }
    }

    @media (min-width: 1320px) {
      .finance-layout {
        grid-template-columns: 430px minmax(0, 1fr);
      }
    }

    @media (max-width: 520px) {
      .toolbar {
        flex-wrap: nowrap;
        overflow-x: auto;
        padding-bottom: 0.2rem;
        scrollbar-width: none;
      }

      .toolbar::-webkit-scrollbar {
        display: none;
      }

      .finance-note,
      .row-actions {
        align-items: stretch;
      }

      .finance-note app-ui-button,
      .row-actions app-ui-button {
        flex: 1 1 100%;
      }
    }
  `],
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
    date: [new Date().toISOString().slice(0, 10), Validators.required],
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
    return `${transaction.category?.name || 'Sem categoria'} · ${new Date(transaction.date).toLocaleDateString('pt-BR')}`;
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
