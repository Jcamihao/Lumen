import { CommonModule, CurrencyPipe, DatePipe, NgClass } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DashboardSummary, Goal, Insight, Task, Transaction } from '../../../core/models/domain.models';
import { LifeApiService } from '../../../core/services/life-api.service';
import { formatLocalDateLabel } from '../../../core/utils/date.utils';
import { ChartCardComponent, ChartSignal } from '../../../shared/components/chart-card/chart-card.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { ListItemComponent } from '../../../shared/components/list-item/list-item.component';
import { MetricCardComponent } from '../../../shared/components/metric-card/metric-card.component';
import { PanelComponent } from '../../../shared/components/panel/panel.component';
import { UiBadgeComponent } from '../../../shared/components/ui-badge/ui-badge.component';
import { UiButtonComponent } from '../../../shared/components/ui-button/ui-button.component';

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
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss'],
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
    return `${transaction.category?.name || 'Sem categoria'} · ${formatLocalDateLabel(transaction.date)}`;
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
    const overduePressure =
      data.tasks.overdueCount * Math.max(monthlyExpenses * 0.018, balance * 0.012, 45);
    const weeklyIncomePace = monthlyIncome / 4.4;
    const weeklyExpensePace = monthlyExpenses / 4.2;

    return [
      balance * 0.96,
      balance + weeklyIncomePace * 0.18 - weeklyExpensePace * 0.16,
      balance + weeklyIncomePace * 0.42 - weeklyExpensePace * 0.24,
      balance + weeklyIncomePace * 0.32 - weeklyExpensePace * 0.42,
      balance + weeklyIncomePace * 0.1 - weeklyExpensePace * 0.56 - overduePressure * 0.18,
      balance - pendingCost * 0.18 - overduePressure * 0.28,
      data.forecast.predictedBalance,
    ].map((value) => Math.round(value));
  }

  protected projectionLabels() {
    return ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  }

  protected projectionSignals(data: DashboardSummary): ChartSignal[] {
    const series = this.projectionSeries(data);
    const labels = this.projectionLabels();
    const peak = Math.max(...series);
    const floor = Math.min(...series);
    const peakIndex = series.indexOf(peak);
    const floorIndex = series.indexOf(floor);
    const pendingCost = data.tasks.items.reduce(
      (total, task) => total + (task.estimatedAmount ?? 0),
      0,
    );
    const costTasks = data.tasks.items.filter((task) => task.hasFinancialImpact).length;

    return [
      {
        label: 'Pico projetado',
        value: this.formatCompactCurrency(peak, data.user.preferredCurrency),
        detail: `Maior fôlego previsto para ${labels[peakIndex].toLowerCase()}.`,
        tone: 'accent',
      },
      {
        label: 'Piso provável',
        value: this.formatCompactCurrency(floor, data.user.preferredCurrency),
        detail: `Faixa mais pressionada em ${labels[floorIndex].toLowerCase()}.`,
        tone: this.forecastTone(data.forecast.riskLevel),
      },
      {
        label: 'Custos em aberto',
        value: this.formatCompactCurrency(pendingCost, data.user.preferredCurrency),
        detail: costTasks
          ? `${costTasks} tarefa(s) ainda podem mexer no caixa.`
          : 'Nenhuma tarefa com impacto financeiro aberta.',
        tone: pendingCost > 0 ? 'warning' : 'success',
      },
    ];
  }

  private formatCompactCurrency(value: number, currencyCode: string) {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    const compact = new Intl.NumberFormat('pt-BR', {
      notation: 'compact',
      maximumFractionDigits: abs >= 1000 ? 1 : 0,
    }).format(abs);
    const currency = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'symbol',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((part) => part.type === 'currency')
      ?.value || currencyCode;

    return `${sign}${currency} ${compact}`;
  }
}
