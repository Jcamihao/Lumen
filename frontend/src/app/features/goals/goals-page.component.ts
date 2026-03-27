import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Goal } from '../../core/models/domain.models';
import { AuthService } from '../../core/services/auth.service';
import { LifeApiService } from '../../core/services/life-api.service';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { FieldShellComponent } from '../../shared/components/field-shell.component';
import { MetricCardComponent } from '../../shared/components/metric-card.component';
import { PanelComponent } from '../../shared/components/panel.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge.component';
import { UiButtonComponent } from '../../shared/components/ui-button.component';

@Component({
  selector: 'app-goals-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CurrencyPipe,
    DatePipe,
    PanelComponent,
    EmptyStateComponent,
    FieldShellComponent,
    UiButtonComponent,
    UiBadgeComponent,
    MetricCardComponent,
  ],
  template: `
    <div class="page-stack">
      <section class="metrics">
        <app-metric-card
          label="Metas ativas"
          [value]="goals().length"
          caption="Objetivos em andamento"
        />
        <app-metric-card
          label="Valor acumulado"
          [value]="savedTotal()"
          [currency]="true"
          [currencyCode]="currencyCode()"
          caption="Total já guardado"
          tone="success"
        />
        <app-metric-card
          label="Progresso médio"
          [value]="averageProgress() + '%'"
          caption="Ritmo geral das metas"
          tone="warning"
        />
      </section>

      <section class="split-layout goals-layout">
        <app-panel title="Nova meta" caption="Conecte ambição, prazo e valor de forma elegante">
          <form class="form-grid" [formGroup]="form" (ngSubmit)="createGoal()">
            <app-field-shell label="Título" hint="Obrigatório">
              <input type="text" formControlName="title" placeholder="Ex.: Viagem para Lisboa">
            </app-field-shell>

            <app-field-shell label="Descrição" hint="Opcional">
              <textarea rows="4" formControlName="description" placeholder="Por que essa meta importa?"></textarea>
            </app-field-shell>

            <div class="grid-2">
              <app-field-shell label="Valor alvo">
                <input type="number" formControlName="targetAmount" placeholder="12000">
              </app-field-shell>

              <app-field-shell label="Valor atual">
                <input type="number" formControlName="currentAmount" placeholder="0">
              </app-field-shell>
            </div>

            <app-field-shell label="Data alvo">
              <input type="date" formControlName="targetDate">
            </app-field-shell>

            <app-ui-button type="submit" [disabled]="form.invalid" [fullWidth]="true" icon="flag">
              Criar meta
            </app-ui-button>
          </form>
        </app-panel>

        <app-panel title="Metas em andamento" caption="Acompanhe evolução e faça aportes rápidos">
          <div class="goal-grid" *ngIf="goals().length; else noGoals">
            <article class="goal-card" *ngFor="let goal of goals()">
              <div class="goal-card-top">
                <div>
                  <strong>{{ goal.title }}</strong>
                  <p>{{ goal.targetDate ? (goal.targetDate | date: 'dd/MM/yyyy') : 'Sem prazo definido' }}</p>
                </div>
                <app-ui-badge
                  [label]="goal.status === 'ACHIEVED' ? 'Concluída' : 'Ativa'"
                  [tone]="goal.status === 'ACHIEVED' ? 'success' : 'accent'"
                  [showDot]="false"
                />
              </div>

              <div class="progress-track">
                <span class="progress-fill" [style.width.%]="progress(goal)"></span>
              </div>

              <div class="goal-summary">
                <span>{{ progress(goal) }}%</span>
                <strong>
                  {{ goal.currentAmount | currency: currencyCode() : 'symbol' : '1.0-0' : 'pt-BR' }}
                </strong>
              </div>

              <p class="goal-copy">
                de
                {{ goal.targetAmount | currency: currencyCode() : 'symbol' : '1.0-0' : 'pt-BR' }}
                planejados
              </p>

              <div class="goal-actions">
                <app-ui-button variant="secondary" size="sm" (click)="contribute(goal, 100)">
                  +100
                </app-ui-button>
                <app-ui-button variant="secondary" size="sm" (click)="contribute(goal, 500)">
                  +500
                </app-ui-button>
                <app-ui-button variant="ghost" size="sm" (click)="removeGoal(goal.id)">
                  Excluir
                </app-ui-button>
              </div>
            </article>
          </div>

          <ng-template #noGoals>
            <app-empty-state
              title="Nenhuma meta ativa"
              description="Crie um destino para o LUMEN orientar melhor suas decisões."
              icon="flag"
            />
          </ng-template>
        </app-panel>
      </section>
    </div>
  `,
  styles: [`
    .metrics,
    .form-grid,
    .goal-grid {
      display: grid;
      gap: 1rem;
    }

    .grid-2 {
      display: grid;
      gap: 0.9rem;
    }

    .goal-card {
      display: grid;
      gap: 0.9rem;
      padding: 1rem;
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
      background: var(--card-muted);
    }

    .goal-card-top,
    .goal-summary,
    .goal-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .goal-card-top p,
    .goal-copy {
      margin: 0.22rem 0 0;
      color: var(--text-medium);
      font-size: 0.9rem;
    }

    .goal-copy {
      margin: 0;
    }

    .goal-summary span {
      color: var(--text-secondary);
      font-weight: 700;
      font-size: 0.84rem;
    }

    @media (min-width: 860px) {
      .metrics {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .goals-layout {
        grid-template-columns: 380px minmax(0, 1fr);
      }

      .grid-2 {
        grid-template-columns: 1fr 1fr;
      }
    }

    @media (max-width: 520px) {
      .goal-card-top,
      .goal-summary,
      .goal-actions {
        display: grid;
        justify-content: stretch;
      }

      .goal-actions app-ui-button {
        width: 100%;
      }
    }
  `],
})
export class GoalsPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly goals = signal<Goal[]>([]);
  protected readonly currencyCode = signal(
    this.authService.currentUser()?.preferredCurrency ?? 'BRL',
  );
  protected readonly savedTotal = computed(
    () => this.goals().reduce((total, goal) => total + goal.currentAmount, 0),
  );
  protected readonly averageProgress = computed(() => {
    if (!this.goals().length) {
      return 0;
    }

    return Math.round(
      this.goals().reduce((total, goal) => total + this.progress(goal), 0) / this.goals().length,
    );
  });

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    targetAmount: [12000, [Validators.required, Validators.min(1)]],
    currentAmount: [0],
    targetDate: [''],
  });

  constructor() {
    this.reload();
  }

  protected createGoal() {
    const raw = this.form.getRawValue();
    this.api
      .createGoal({
        title: raw.title,
        description: raw.description || undefined,
        targetAmount: raw.targetAmount,
        currentAmount: raw.currentAmount || 0,
        targetDate: raw.targetDate || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.form.reset({
          title: '',
          description: '',
          targetAmount: 12000,
          currentAmount: 0,
          targetDate: '',
        });
        this.reload();
      });
  }

  protected contribute(goal: Goal, amount: number) {
    this.api
      .contributeGoal(goal.id, { amount })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());
  }

  protected removeGoal(id: string) {
    this.api
      .deleteGoal(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());
  }

  protected progress(goal: Goal) {
    return Math.min(Math.round((goal.currentAmount / goal.targetAmount) * 100), 100);
  }

  private reload() {
    this.api
      .listGoals()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((goals) => this.goals.set(goals));
  }
}
