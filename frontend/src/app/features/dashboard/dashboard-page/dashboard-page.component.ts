import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DashboardSummary, Goal, Task, Transaction } from '../../../core/models/domain.models';
import { LifeApiService } from '../../../core/services/life-api.service';
import { formatLocalDateLabel, todayLocalInputValue } from '../../../core/utils/date.utils';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    return `Bom te ver, ${this.firstName(name)}.`;
  }

  protected dashboardSubtitle(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0) {
      return `Você tem ${data.tasks.overdueCount} pendência(s) atrasada(s). O melhor agora é destravar uma coisa de cada vez.`;
    }

    if (data.tasks.todayCount > 0) {
      return `Existem ${data.tasks.todayCount} tarefa(s) para hoje. O dashboard mostra só o que ajuda a começar.`;
    }

    return 'A home organiza tarefas, caixa e metas em uma leitura única para começar com clareza.';
  }

  protected todayLabel() {
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
    }).format(new Date());
  }

  protected firstName(name: string) {
    return name.trim().split(/\s+/)[0] || 'por aqui';
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

  protected unreadNotifications(data: DashboardSummary) {
    return data.notifications.filter((notification) => !notification.isRead).length;
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

  protected primaryFocusIcon(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0 || this.todayTasks(data)[0]) {
      return 'task_alt';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return 'account_balance_wallet';
    }

    return 'space_dashboard';
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

  protected assistantPrompt(data: DashboardSummary) {
    if (data.tasks.overdueCount > 0) {
      return 'Como eu destravo minhas tarefas atrasadas hoje?';
    }

    if (this.todayTasks(data)[0]) {
      return 'Qual é a melhor ordem para executar minhas tarefas de hoje?';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return 'O que eu preciso ajustar no meu caixa este mês?';
    }

    return 'O que merece minha atenção no Lumen hoje?';
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

  protected averageGoalProgress(goals: Goal[]) {
    if (!goals.length) {
      return 0;
    }

    const total = goals.reduce((sum, goal) => sum + this.progress(goal), 0);
    return Math.round(total / goals.length);
  }

  protected dailyScore(data: DashboardSummary) {
    const overduePenalty = Math.min(data.tasks.overdueCount * 16, 48);
    const radarPenalty = Math.min(this.radarItemsCount(data) * 4, 20);
    const financePenalty = data.forecast.riskLevel === 'HIGH' ? 22 : data.forecast.riskLevel === 'MEDIUM' ? 10 : 0;
    const goalBoost = Math.min(Math.round(this.averageGoalProgress(data.goals) / 8), 10);

    return Math.max(18, Math.min(98, 84 - overduePenalty - radarPenalty - financePenalty + goalBoost));
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

  protected projectionBarHeight(data: DashboardSummary, value: number) {
    const series = this.projectionSeries(data);
    const min = Math.min(...series);
    const max = Math.max(...series);

    if (max === min) {
      return 52;
    }

    return Math.round(28 + ((value - min) / (max - min)) * 68);
  }

  protected formatCurrency(value: number, currencyCode: string) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(value);
  }
}
