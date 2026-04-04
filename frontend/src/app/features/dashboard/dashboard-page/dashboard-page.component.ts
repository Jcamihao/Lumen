import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { auditTime, fromEvent, map, startWith } from 'rxjs';
import { DashboardSummary, Goal, Insight, Task, Transaction } from '../../../core/models/domain.models';
import { LifeApiService } from '../../../core/services/life-api.service';
import { formatLocalDateLabel, todayLocalInputValue } from '../../../core/utils/date.utils';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--dashboard-parallax]': 'parallaxOffset()',
    '[style.--dashboard-parallax-soft]': 'parallaxSoftOffset()',
  },
})
export class DashboardPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scrollDepth = signal(0);
  protected readonly showExtendedPanels = signal(false);
  protected readonly summary = signal<DashboardSummary | null>(null);
  protected readonly parallaxOffset = computed(
    () => `${Math.min(this.scrollDepth(), 360) * 0.14}px`,
  );
  protected readonly parallaxSoftOffset = computed(
    () => `${Math.min(this.scrollDepth(), 360) * 0.08}px`,
  );

  constructor() {
    this.api
      .getDashboardSummary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((summary) => this.summary.set(summary));

    if (typeof window !== 'undefined') {
      fromEvent(window, 'scroll', { passive: true }).pipe(
        startWith(0),
        auditTime(16),
        map(() => window.scrollY || window.pageYOffset || 0),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe((scrollY) => this.scrollDepth.set(scrollY));
    }
  }

  protected greeting(name: string) {
    return `${name}, aqui vai o essencial do seu dia.`;
  }

  protected dashboardSubtitle(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0) {
      return `Você tem ${data.tasks.overdueCount} pendência(s) atrasada(s). O melhor agora é destravar uma coisa de cada vez.`;
    }

    if (data.tasks.todayCount > 0) {
      return `Existem ${data.tasks.todayCount} tarefa(s) para hoje. O dashboard mostra só o que ajuda a começar.`;
    }

    return 'Seu painel ficou mais enxuto para destacar apenas o que pede atenção agora.';
  }

  protected todayLabel() {
    return new Intl.DateTimeFormat('pt-BR', {
      day: 'numeric',
      month: 'long',
    }).format(new Date());
  }

  protected riskLabel(level: DashboardSummary['forecast']['riskLevel']) {
    if (level === 'HIGH') {
      return 'alto';
    }

    if (level === 'MEDIUM') {
      return 'moderado';
    }

    return 'baixo';
  }

  protected progress(goal: Goal) {
    return Math.min(Math.round((goal.currentAmount / goal.targetAmount) * 100), 100);
  }

  protected todayTasks(data: DashboardSummary) {
    const tasksForToday = data.tasks.items.filter((task) => {
      if (!task.dueDate) {
        return false;
      }

      return String(task.dueDate).slice(0, 10) === todayLocalInputValue();
    });

    return tasksForToday.length ? tasksForToday : data.tasks.items;
  }

  protected radarItemsCount(data: DashboardSummary) {
    return data.reminders.length + data.notifications.length;
  }

  protected primaryFocusTitle(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0) {
      return `${data.tasks.overdueCount} pendência(s) atrasada(s)`;
    }

    const task = this.todayTasks(data)[0];
    if (task) {
      return task.title;
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return 'Seu caixa merece revisao hoje';
    }

    return 'Seu dia esta sob controle';
  }

  protected primaryFocusText(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0) {
      return 'Resolva a mais urgente antes de abrir novas frentes. Isso reduz a sensação de bagunça mais rápido.';
    }

    const task = this.todayTasks(data)[0];
    if (task) {
      return task.description || 'Essa é a tarefa mais concreta para começar sem pensar demais.';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return 'As saídas e compromissos do período estão pressionando a previsão do mês.';
    }

    return 'Sem alertas fortes no momento. Você pode usar o app só para acompanhar o básico.';
  }

  protected primaryFocusAction(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0 || this.todayTasks(data)[0]) {
      return 'Abrir tarefas';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return 'Revisar caixa';
    }

    return 'Ver dashboard';
  }

  protected primaryFocusRoute(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0 || this.todayTasks(data)[0]) {
      return '/tasks';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return '/finance';
    }

    return '/dashboard';
  }

  protected primaryFocusTag(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0) {
      return 'Urgente';
    }

    if (this.todayTasks(data)[0]) {
      return 'Hoje';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return 'Caixa';
    }

    return 'Calmo';
  }

  protected primaryFocusLabel(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0) {
      return 'Primeiro, feche o que já atrasou.';
    }

    if (this.todayTasks(data)[0]) {
      return 'Seu próximo passo mais claro.';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return 'Vale revisar o financeiro antes de seguir.';
    }

    return 'Nada crítico pedindo ação imediata.';
  }

  protected primaryFocusTone(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0) {
      return 'danger';
    }

    if (this.todayTasks(data)[0]) {
      return 'accent';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return 'warning';
    }

    return 'success';
  }

  protected financeSummaryText(data: DashboardSummary) {
    const delta = this.projectionDelta(data);
    return `Saldo atual em ${new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: data.user.preferredCurrency,
      maximumFractionDigits: 0,
    }).format(data.finances.balance)}. A projeção do mês aponta ${delta}.`;
  }

  protected totalGoalCurrent(goals: Goal[]) {
    return goals.reduce((total, goal) => total + goal.currentAmount, 0);
  }

  protected totalGoalTarget(goals: Goal[]) {
    return goals.reduce((total, goal) => total + goal.targetAmount, 0);
  }

  protected toggleExtendedPanels() {
    this.showExtendedPanels.update((value) => !value);
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

}
