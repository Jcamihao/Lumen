import { CommonModule, CurrencyPipe, DatePipe, NgClass } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DashboardSummary, Goal, Insight, Task, Transaction } from '../../core/models/domain.models';
import { LifeApiService } from '../../core/services/life-api.service';
import { ChartCardComponent } from '../../shared/components/chart-card.component';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { ListItemComponent } from '../../shared/components/list-item.component';
import { MetricCardComponent } from '../../shared/components/metric-card.component';
import { PanelComponent } from '../../shared/components/panel.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge.component';
import { UiButtonComponent } from '../../shared/components/ui-button.component';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CurrencyPipe,
    DatePipe,
    NgClass,
    MetricCardComponent,
    PanelComponent,
    EmptyStateComponent,
    UiBadgeComponent,
    UiButtonComponent,
    ListItemComponent,
    ChartCardComponent,
  ],
  template: `
    <div class="page-stack" *ngIf="summary() as data; else skeleton">
      <section class="hero-card">
        <div class="hero-copy">
          <p class="section-kicker">Visão integrada</p>
          <h2>{{ greeting(data.user.name) }}</h2>
          <p class="hero-text">
            Hoje o LUMEN cruzou suas prioridades, movimentos financeiros e metas
            para sugerir um ritmo mais claro para o restante do dia.
          </p>

          <div class="hero-actions">
            <app-ui-badge
              [label]="'Risco ' + data.forecast.riskLevel.toLowerCase()"
              [tone]="forecastTone(data.forecast.riskLevel)"
            />
            <app-ui-badge
              [label]="data.tasks.todayCount + ' tarefas hoje'"
              tone="dark"
            />
          </div>
        </div>

        <div class="hero-aside">
          <span class="eyebrow">Saldo previsto</span>
          <strong class="hero-balance">
            {{ data.forecast.predictedBalance | currency: data.user.preferredCurrency : 'symbol' : '1.0-0' : 'pt-BR' }}
          </strong>
          <p>
            Considerando gastos atuais, tarefas com custo e o comportamento do
            seu mês.
          </p>

          <div class="hero-stats">
            <div>
              <span>Entradas</span>
              <strong class="hero-stat-value">
                {{ data.finances.monthlyIncome | currency: data.user.preferredCurrency : 'symbol' : '1.0-0' : 'pt-BR' }}
              </strong>
            </div>
            <div>
              <span>Saídas</span>
              <strong class="hero-stat-value">
                {{ data.finances.monthlyExpenses | currency: data.user.preferredCurrency : 'symbol' : '1.0-0' : 'pt-BR' }}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section class="metrics">
        <app-metric-card
          label="Saldo atual"
          [value]="data.finances.balance"
          [currency]="true"
          [currencyCode]="data.user.preferredCurrency"
          caption="Seu caixa visível agora"
          tone="success"
        />
        <app-metric-card
          label="Despesas do mês"
          [value]="data.finances.monthlyExpenses"
          [currency]="true"
          [currencyCode]="data.user.preferredCurrency"
          caption="Saída consolidada até aqui"
          tone="warning"
        />
        <app-metric-card
          label="Prioridades"
          [value]="data.tasks.todayCount"
          caption="Tarefas previstas para hoje"
        />
        <app-metric-card
          label="Atenções"
          [value]="data.tasks.overdueCount"
          caption="Itens que já passaram do ponto"
          tone="danger"
        />
      </section>

      <section class="dashboard-grid">
        <app-chart-card
          class="span-two"
          title="Pulso financeiro da semana"
          caption="Tendência suave entre saldo, pressão de despesas e previsão."
          [value]="(data.finances.balance | currency: data.user.preferredCurrency : 'symbol' : '1.0-0' : 'pt-BR') ?? ''"
          helper="Leitura contínua do fluxo para não decidir no escuro."
          [delta]="projectionDelta(data)"
          [deltaTone]="forecastTone(data.forecast.riskLevel)"
          [data]="projectionSeries(data)"
          [labels]="projectionLabels()"
        />

        <app-panel title="Foco de hoje" caption="O que mais move sua vida agora">
          <div class="stack-list" *ngIf="data.tasks.items.length; else noTasks">
            <app-list-item
              *ngFor="let task of data.tasks.items"
              [title]="task.title"
              [subtitle]="taskSubtitle(task)"
              [meta]="taskMeta(task)"
              [metaTone]="task.hasFinancialImpact ? 'warning' : 'neutral'"
              [badge]="priorityLabel(task.priority)"
              [badgeTone]="priorityTone(task.priority)"
              [checkable]="true"
              [checked]="task.status === 'DONE'"
            >
              <div list-actions class="row-actions">
                <app-ui-button variant="ghost" size="sm" routerLink="/tasks">
                  Abrir
                </app-ui-button>
              </div>
            </app-list-item>
          </div>

          <ng-template #noTasks>
            <app-empty-state
              title="Agenda leve"
              description="Nenhuma tarefa registrada para hoje."
              icon="nest_clock_farsight_analog"
            />
          </ng-template>
        </app-panel>

        <app-panel title="Insights do Lumen" caption="Leitura rápida do seu momento">
          <div class="insight-list" *ngIf="data.insights.length; else noInsights">
            <article
              class="insight-card"
              *ngFor="let insight of data.insights"
              [ngClass]="severityTone(insight)"
            >
              <div class="insight-top">
                <app-ui-badge
                  [label]="insight.type"
                  [tone]="severityTone(insight)"
                  [showDot]="false"
                />
                <span>{{ insight.severity }}</span>
              </div>
              <p>{{ insight.message }}</p>
            </article>
          </div>

          <ng-template #noInsights>
            <app-empty-state
              title="Sem alertas relevantes"
              description="Seu cenário está equilibrado neste momento."
              icon="lightbulb"
            />
          </ng-template>
        </app-panel>

        <app-panel
          class="span-two"
          title="Metas conectadas"
          caption="Objetivos com leitura de progresso e contexto financeiro"
        >
          <div class="goals-overview" *ngIf="data.goals.length; else noGoals">
            <div class="goal-summary">
              <span>Progresso total</span>
              <strong>
                {{ totalGoalCurrent(data.goals) | currency: data.user.preferredCurrency : 'symbol' : '1.0-0' : 'pt-BR' }}
              </strong>
              <p>
                de
                {{ totalGoalTarget(data.goals) | currency: data.user.preferredCurrency : 'symbol' : '1.0-0' : 'pt-BR' }}
                acumulados nas metas ativas.
              </p>
            </div>

            <div class="goal-grid">
              <article class="goal-card" *ngFor="let goal of data.goals">
                <div class="goal-card-top">
                  <div>
                    <strong>{{ goal.title }}</strong>
                    <p>{{ goal.targetDate ? (goal.targetDate | date: 'dd MMM yyyy') : 'Sem data alvo' }}</p>
                  </div>
                  <app-ui-badge
                    [label]="goalStatus(goal)"
                    [tone]="goal.status === 'ACHIEVED' ? 'success' : 'accent'"
                    [showDot]="false"
                  />
                </div>
                <div class="progress-track">
                  <span class="progress-fill" [style.width.%]="progress(goal)"></span>
                </div>
                <div class="goal-card-bottom">
                  <span>{{ progress(goal) }}%</span>
                  <strong>
                    {{ goal.currentAmount | currency: data.user.preferredCurrency : 'symbol' : '1.0-0' : 'pt-BR' }}
                  </strong>
                </div>
              </article>
            </div>
          </div>

          <ng-template #noGoals>
            <app-empty-state
              title="Sem metas ativas"
              description="Crie um destino para o LUMEN equilibrar tempo e dinheiro."
              icon="flag"
            />
          </ng-template>
        </app-panel>

        <app-panel title="Últimos movimentos" caption="Dinheiro recente com contexto">
          <div class="stack-list" *ngIf="data.finances.recentTransactions.length; else noTransactions">
            <app-list-item
              *ngFor="let transaction of data.finances.recentTransactions"
              [title]="transaction.description"
              [subtitle]="transactionSubtitle(transaction)"
              [meta]="transactionAmount(transaction, data.user.preferredCurrency)"
              [metaTone]="transaction.type === 'INCOME' ? 'positive' : 'negative'"
              [avatar]="transaction.description"
            >
              <div list-actions class="row-actions">
                <app-ui-button variant="ghost" size="sm" routerLink="/finances">
                  Detalhes
                </app-ui-button>
              </div>
            </app-list-item>
          </div>

          <ng-template #noTransactions>
            <app-empty-state
              title="Sem movimentações"
              description="Registre receitas e despesas para destravar previsões melhores."
              icon="payments"
            />
          </ng-template>
        </app-panel>

        <app-panel title="Radar do dia" caption="Lembretes e sinais que merecem atenção">
          <div class="radar-list" *ngIf="data.reminders.length || data.notifications.length; else noRadar">
            <article class="radar-item" *ngFor="let reminder of data.reminders">
              <div>
                <strong>{{ reminder.title }}</strong>
                <p>Lembrete programado</p>
              </div>
              <span>{{ reminder.remindAt | date: 'dd/MM HH:mm' }}</span>
            </article>

            <article class="radar-item" *ngFor="let notification of data.notifications | slice:0:3">
              <div>
                <strong>{{ notification.title }}</strong>
                <p>{{ notification.message }}</p>
              </div>
              <span>{{ notification.createdAt | date: 'dd/MM HH:mm' }}</span>
            </article>
          </div>

          <ng-template #noRadar>
            <app-empty-state
              title="Tudo em silêncio"
              description="Nenhum lembrete ou alerta extra apareceu até agora."
              icon="notifications"
            />
          </ng-template>
        </app-panel>
      </section>
    </div>

    <ng-template #skeleton>
      <section class="skeleton-grid">
        <div class="hero-skeleton skeleton-shimmer"></div>
        <div class="metric-skeleton skeleton-shimmer" *ngFor="let item of [1, 2, 3, 4]"></div>
        <div class="panel-skeleton skeleton-shimmer" *ngFor="let item of [1, 2, 3, 4]"></div>
      </section>
    </ng-template>
  `,
  styles: [`
    .hero-card {
      display: grid;
      gap: 1.25rem;
      padding: 1.45rem;
      border-radius: var(--radius-2xl);
      background:
        radial-gradient(circle at top left, rgba(129, 140, 248, 0.3), transparent 28%),
        linear-gradient(135deg, rgba(17, 17, 17, 0.98), rgba(37, 40, 55, 0.94));
      color: #f5f7ff;
      box-shadow: var(--shadow-float);
    }

    .hero-copy {
      display: grid;
      gap: 0.85rem;
    }

    .hero-copy .section-kicker {
      color: rgba(255, 255, 255, 0.68);
    }

    .hero-copy .section-kicker::before {
      box-shadow: 0 0 0 6px rgba(129, 140, 248, 0.2);
    }

    h2 {
      margin: 0;
      font-size: clamp(1.9rem, 3.8vw, 3rem);
      line-height: 1.02;
      letter-spacing: -0.05em;
    }

    .hero-text {
      margin: 0;
      max-width: 44rem;
      color: rgba(255, 255, 255, 0.74);
      font-size: 1rem;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.7rem;
    }

    .hero-aside {
      display: grid;
      gap: 0.55rem;
      padding: 1.25rem;
      border-radius: var(--radius-xl);
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(18px);
    }

    .eyebrow {
      color: rgba(255, 255, 255, 0.62);
      font-size: 0.74rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 700;
    }

    .hero-aside strong {
      color: #ffffff;
      font-size: clamp(1.7rem, 2.4vw, 2.3rem);
      line-height: 1.08;
    }

    .hero-balance {
      display: block;
      margin-top: 0.15rem;
      letter-spacing: -0.04em;
    }

    .hero-aside p {
      margin: 0;
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.94rem;
    }

    .hero-stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.75rem;
      margin-top: 0.4rem;
    }

    .hero-stats div {
      display: grid;
      gap: 0.2rem;
      padding: 0.9rem;
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.06);
    }

    .hero-stats span {
      color: rgba(255, 255, 255, 0.58);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .hero-stats strong {
      font-size: 1rem;
    }

    .hero-stat-value {
      display: block;
      margin-top: 0.1rem;
    }

    .metrics,
    .dashboard-grid,
    .stack-list,
    .insight-list,
    .radar-list {
      display: grid;
      gap: 1rem;
    }

    .goals-overview {
      display: grid;
      gap: 1rem;
    }

    .goal-summary {
      display: grid;
      gap: 0.35rem;
      padding: 1rem;
      border-radius: var(--radius-lg);
      background: var(--card-muted);
      border: 1px solid var(--border);
    }

    .goal-summary span {
      color: var(--text-secondary);
      font-size: 0.74rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 700;
    }

    .goal-summary strong {
      font-size: clamp(1.4rem, 2vw, 2rem);
    }

    .goal-summary p {
      margin: 0;
      color: var(--text-medium);
    }

    .goal-grid {
      display: grid;
      gap: 1rem;
    }

    .goal-card {
      display: grid;
      gap: 0.85rem;
      padding: 1rem;
      border-radius: var(--radius-lg);
      background: var(--card-muted);
      border: 1px solid var(--border);
    }

    .goal-card-top,
    .goal-card-bottom,
    .radar-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.85rem;
    }

    .goal-card-top p,
    .radar-item p {
      margin: 0.22rem 0 0;
      color: var(--text-medium);
      font-size: 0.9rem;
    }

    .goal-card-bottom span {
      color: var(--text-secondary);
      font-size: 0.86rem;
      font-weight: 700;
    }

    .insight-card {
      display: grid;
      gap: 0.7rem;
      padding: 1rem;
      border-radius: var(--radius-lg);
      border: 1px solid transparent;
      background: var(--card-muted);
    }

    .insight-card.accent {
      border-color: rgba(99, 102, 241, 0.14);
      background: rgba(99, 102, 241, 0.08);
    }

    .insight-card.warning {
      border-color: rgba(245, 158, 11, 0.16);
      background: rgba(245, 158, 11, 0.08);
    }

    .insight-card.danger {
      border-color: rgba(239, 68, 68, 0.18);
      background: rgba(239, 68, 68, 0.08);
    }

    .insight-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .insight-top span {
      color: var(--text-secondary);
      font-size: 0.82rem;
      font-weight: 600;
    }

    .insight-card p {
      margin: 0;
      color: var(--text-primary);
      line-height: 1.55;
    }

    .row-actions {
      display: flex;
      gap: 0.55rem;
      flex-wrap: wrap;
    }

    .radar-item {
      padding: 0.95rem 1rem;
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      background: var(--card-muted);
    }

    .radar-item span {
      color: var(--text-secondary);
      font-size: 0.84rem;
      white-space: nowrap;
    }

    .skeleton-grid {
      display: grid;
      gap: 1rem;
    }

    .hero-skeleton {
      min-height: 280px;
      border-radius: var(--radius-2xl);
    }

    .metric-skeleton {
      min-height: 148px;
      border-radius: var(--radius-lg);
    }

    .panel-skeleton {
      min-height: 240px;
      border-radius: var(--radius-xl);
    }

    @media (min-width: 860px) {
      .hero-card {
        grid-template-columns: minmax(0, 1.35fr) minmax(340px, 0.65fr);
        align-items: stretch;
      }

      .metrics {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .dashboard-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .span-two {
        grid-column: span 2;
      }

      .goal-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .hero-card {
        padding: 1.1rem;
        border-radius: var(--radius-xl);
      }

      .hero-aside {
        padding: 1rem;
      }
    }

    @media (max-width: 520px) {
      .hero-stats {
        grid-template-columns: 1fr;
      }

      .goal-card-top,
      .goal-card-bottom,
      .radar-item {
        display: grid;
        justify-content: stretch;
      }

      .radar-item span {
        white-space: normal;
      }

      .row-actions {
        width: 100%;
      }

      .row-actions app-ui-button {
        flex: 1 1 100%;
      }
    }
  `],
})
export class DashboardPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly summary = signal<DashboardSummary | null>(null);

  constructor() {
    this.api
      .getDashboardSummary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((summary) => this.summary.set(summary));
  }

  protected greeting(name: string) {
    return `${name}, seu dia já ganhou mais clareza.`;
  }

  protected progress(goal: Goal) {
    return Math.min(Math.round((goal.currentAmount / goal.targetAmount) * 100), 100);
  }

  protected totalGoalCurrent(goals: Goal[]) {
    return goals.reduce((total, goal) => total + goal.currentAmount, 0);
  }

  protected totalGoalTarget(goals: Goal[]) {
    return goals.reduce((total, goal) => total + goal.targetAmount, 0);
  }

  protected goalStatus(goal: Goal) {
    if (goal.status === 'ACHIEVED') {
      return 'Concluída';
    }

    if (goal.status === 'PAUSED') {
      return 'Pausada';
    }

    return 'Ativa';
  }

  protected taskSubtitle(task: Task) {
    return task.description || task.category?.name || 'Sem categoria definida';
  }

  protected taskMeta(task: Task) {
    const dueLabel = task.dueDate
      ? new Date(task.dueDate).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'short',
        })
      : 'Sem prazo';

    if (!task.hasFinancialImpact || !task.estimatedAmount) {
      return dueLabel;
    }

    return `${dueLabel} · custo previsto ${new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(task.estimatedAmount)}`;
  }

  protected priorityLabel(priority: Task['priority']) {
    return {
      LOW: 'Baixa',
      MEDIUM: 'Média',
      HIGH: 'Alta',
      CRITICAL: 'Crítica',
    }[priority];
  }

  protected priorityTone(priority: Task['priority']) {
    return {
      LOW: 'neutral',
      MEDIUM: 'accent',
      HIGH: 'warning',
      CRITICAL: 'danger',
    }[priority] as 'neutral' | 'accent' | 'warning' | 'danger';
  }

  protected transactionSubtitle(transaction: Transaction) {
    return `${transaction.category?.name || 'Sem categoria'} · ${new Date(transaction.date).toLocaleDateString('pt-BR')}`;
  }

  protected transactionAmount(transaction: Transaction, currencyCode: string) {
    const formatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(transaction.amount);

    return `${transaction.type === 'INCOME' ? '+' : '-'} ${formatted}`;
  }

  protected severityTone(insight: Insight) {
    if (insight.severity === 'CRITICAL') {
      return 'danger';
    }

    if (insight.severity === 'WARNING') {
      return 'warning';
    }

    return 'accent';
  }

  protected forecastTone(level: DashboardSummary['forecast']['riskLevel']) {
    return {
      LOW: 'success',
      MEDIUM: 'warning',
      HIGH: 'danger',
    }[level] as 'success' | 'warning' | 'danger';
  }

  protected projectionDelta(data: DashboardSummary) {
    const difference = data.forecast.predictedBalance - data.finances.balance;
    const sign = difference >= 0 ? '+' : '-';
    return `${sign} ${new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: data.user.preferredCurrency,
      maximumFractionDigits: 0,
    }).format(Math.abs(difference))}`;
  }

  protected projectionSeries(data: DashboardSummary) {
    const balance = data.finances.balance;
    const monthlyIncome = data.finances.monthlyIncome || data.user.monthlyIncome || 0;
    const monthlyExpenses = data.finances.monthlyExpenses || 0;
    const pendingCost = data.tasks.items.reduce(
      (total, task) => total + (task.estimatedAmount ?? 0),
      0,
    );

    return [
      balance * 0.92,
      balance * 0.98,
      balance + monthlyIncome * 0.12,
      balance + monthlyIncome * 0.12 - monthlyExpenses * 0.18,
      balance - pendingCost * 0.3,
      data.forecast.predictedBalance,
    ].map((value) => Math.round(value));
  }

  protected projectionLabels() {
    return ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  }
}
