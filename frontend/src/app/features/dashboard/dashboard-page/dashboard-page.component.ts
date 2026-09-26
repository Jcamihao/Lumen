import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subscription, timeout } from 'rxjs';
import {
  DashboardSummary,
  ForecastAccuracy,
  Goal,
  Insight,
  Task,
  Transaction,
} from '../../../core/models/domain.models';
import { LifeApiService } from '../../../core/services/life-api.service';
import { formatDayLabel, formatLocalDateLabel, todayLocalInputValue } from '../../../core/utils/date.utils';
import { buildOnboarding } from '../../../core/utils/onboarding.utils';
import { buildSpendingBreakdown } from '../../../core/utils/spending.utils';
import { SpendingBreakdownComponent } from '../../../shared/spending-breakdown/spending-breakdown.component';

/** Sem resposta em 15 s o servidor provavelmente ja esta processando; o retry costuma pegar o cache pronto. */
export const SUMMARY_TIMEOUT_MS = 15_000;
/** Depois disso o esqueleto avisa que esta demorando, para o usuario nao achar que travou. */
export const SLOW_HINT_AFTER_MS = 5_000;

const ONBOARDING_DISMISSED_KEY = 'lumen.onboarding.dismissed';

// localStorage pode lancar (janela privada, dados bloqueados): o onboarding so volta a aparecer.
function readOnboardingDismissed(userId: string) {
  try {
    return localStorage.getItem(`${ONBOARDING_DISMISSED_KEY}.${userId}`) === '1';
  } catch {
    return false;
  }
}

function writeOnboardingDismissed(userId: string) {
  try {
    localStorage.setItem(`${ONBOARDING_DISMISSED_KEY}.${userId}`, '1');
  } catch {
    // sem persistencia: vale so ate recarregar
  }
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink, SpendingBreakdownComponent],
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly summary = signal<DashboardSummary | null>(null);
  protected readonly forecastAccuracy = signal<ForecastAccuracy | null>(null);
  private readonly monthExpenses = signal<Transaction[]>([]);
  private readonly spendingMonth = signal(new Date().getMonth() + 1);
  private readonly spendingYear = signal(new Date().getFullYear());
  private spendingRequestId = 0;
  protected readonly onboarding = computed(() => buildOnboarding(this.summary()?.onboarding));
  private readonly onboardingDismissed = signal(false);
  /** Mostra os "primeiros passos" enquanto faltar algum. Quem ja tem dados pode dispensar; conta vazia nao (e o unico conteudo). */
  protected readonly showOnboarding = computed(() => {
    const state = this.onboarding();
    return !!state && !state.allDone && (!state.hasActivity || !this.onboardingDismissed());
  });
  protected readonly loadFailed = signal(false);
  protected readonly loadingSlow = signal(false);
  private summarySubscription?: Subscription;
  private slowHintTimer?: ReturnType<typeof setTimeout>;
  protected readonly spendingBreakdown = computed(() =>
    buildSpendingBreakdown(this.monthExpenses()),
  );
  protected readonly spendingMonthLabel = computed(() =>
    new Date(this.spendingYear(), this.spendingMonth() - 1, 1).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    }),
  );

  constructor() {
    this.loadSummary();
    this.destroyRef.onDestroy(() => {
      this.summarySubscription?.unsubscribe();
      clearTimeout(this.slowHintTimer);
    });

    this.loadSpending();

    this.api
      .getForecastAccuracy()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((accuracy) => this.forecastAccuracy.set(accuracy));
  }

  /** Prazo de meta (so dia), sem deslocar pelo fuso. */
  protected goalDateLabel(value: string) {
    return formatDayLabel(value);
  }

  protected retryLoad() {
    this.loadSummary();
  }

  protected dismissOnboarding() {
    const userId = this.summary()?.user.id;
    if (userId) {
      writeOnboardingDismissed(userId);
    }
    this.onboardingDismissed.set(true);
  }

  /** Conta sem nenhuma tarefa, movimentacao ou meta: ainda nao ha dado para pontuar nem "destaque do dia". */
  protected isBrandNew(data: DashboardSummary) {
    const state = buildOnboarding(data.onboarding);
    return !!state && !state.hasActivity;
  }

  protected showScore(data: DashboardSummary) {
    return !this.isBrandNew(data);
  }

  protected previousSpendingMonth() {
    this.shiftSpendingMonth(-1);
  }

  protected nextSpendingMonth() {
    this.shiftSpendingMonth(1);
  }

  protected isCurrentSpendingMonth() {
    const now = new Date();
    return this.spendingMonth() === now.getMonth() + 1 && this.spendingYear() === now.getFullYear();
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

  protected insightTone(severity: Insight['severity']) {
    if (severity === 'CRITICAL') {
      return 'danger';
    }

    if (severity === 'WARNING') {
      return 'warning';
    }

    return 'accent';
  }

  protected insightIcon(type: Insight['type']) {
    return {
      PRODUCTIVITY: 'checklist',
      FINANCE: 'account_balance_wallet',
      GOAL: 'flag',
      ROUTINE: 'routine',
    }[type];
  }

  /** Nome da persona vindo do backend; cai no rotulo do tipo em insight offline. */
  protected insightPersona(insight: Insight) {
    return insight.metadata?.persona?.name ?? this.insightLabel(insight.type);
  }

  protected insightPersonaRole(insight: Insight) {
    return insight.metadata?.persona?.role ?? null;
  }

  protected insightLabel(type: Insight['type']) {
    return {
      PRODUCTIVITY: 'Tarefas',
      FINANCE: 'Finanças',
      GOAL: 'Metas',
      ROUTINE: 'Ritmo',
    }[type];
  }

  protected insightRoute(type: Insight['type']) {
    return {
      PRODUCTIVITY: '/tasks',
      FINANCE: '/finance',
      GOAL: '/goals',
      ROUTINE: '/tasks',
    }[type];
  }

  protected insightsSubtitle(data: DashboardSummary) {
    const total = data.insights.length;

    if (total === 0) {
      return 'Sem leituras relevantes agora.';
    }

    const critical = data.insights.filter((insight) => insight.severity === 'CRITICAL').length;

    if (critical > 0) {
      return `${critical} leitura(s) pedindo atenção imediata.`;
    }

    return `${total} leitura(s) do seu momento atual.`;
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

  /** Meta sem alvo (cofrinho sem propósito) não tem "%": a tela esconde a barra nesse caso. */
  protected progress(goal: Goal) {
    if (goal.targetAmount === null) return 0;
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
    if (this.isBrandNew(data)) {
      return 'Vamos começar pelo básico';
    }

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
    if (this.isBrandNew(data)) {
      return 'O Lumen aprende com o que você registra. Comece por uma tarefa ou um gasto: leva menos de um minuto.';
    }

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
    if (this.isBrandNew(data)) {
      return 'Criar primeira tarefa';
    }

    if (data.tasks.overdueCount > 0 || this.todayTasks(data)[0]) {
      return 'Abrir tarefas';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return 'Revisar caixa';
    }

    return 'Ver dashboard';
  }

  protected primaryFocusIcon(data: DashboardSummary) {
    if (this.isBrandNew(data)) {
      return 'add_task';
    }

    if (data.tasks.overdueCount > 0 || this.todayTasks(data)[0]) {
      return 'task_alt';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return 'account_balance_wallet';
    }

    return 'space_dashboard';
  }

  protected primaryFocusRoute(data: DashboardSummary) {
    if (this.isBrandNew(data)) {
      return '/tasks';
    }

    if (data.tasks.overdueCount > 0 || this.todayTasks(data)[0]) {
      return '/tasks';
    }

    if (data.forecast.riskLevel === 'HIGH') {
      return '/finance';
    }

    return null;
  }

  protected primaryFocusTag(data: DashboardSummary) {
    if (this.isBrandNew(data)) {
      return 'Novo';
    }

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
    if (this.isBrandNew(data)) {
      return 'Siga os primeiros passos abaixo.';
    }

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
    if (this.isBrandNew(data)) {
      return 'accent';
    }

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
    if (this.isBrandNew(data)) {
      return 'Por onde eu começo no Lumen?';
    }

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
    }).format(data.finances.balance)}. A projeção do mês aponta ${delta}.`;
  }

  // Meta sem alvo nao tem "%": fica fora da media (senao puxaria pra baixo injustamente).
  protected averageGoalProgress(goals: Goal[]) {
    const withTarget = goals.filter((goal) => goal.targetAmount !== null);
    if (!withTarget.length) {
      return 0;
    }

    const total = withTarget.reduce((sum, goal) => sum + this.progress(goal), 0);
    return Math.round(total / withTarget.length);
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

  protected taskMeta(task: Task, currencyCode: string) {
    const dueLabel = task.dueDate
      ? formatDayLabel(task.dueDate, { day: '2-digit', month: 'short' })
      : 'Sem prazo';

    if (!task.hasFinancialImpact || !task.estimatedAmount) {
      return dueLabel;
    }

    return `${dueLabel} · custo previsto ${new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currencyCode,
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

  protected projectionDeltaTone(data: DashboardSummary): 'up' | 'down' | 'flat' {
    const difference = data.forecast.predictedBalance - data.finances.balance;
    if (difference > 0) return 'up';
    if (difference < 0) return 'down';
    return 'flat';
  }

  protected projectionDelta(data: DashboardSummary) {
    const difference = data.forecast.predictedBalance - data.finances.balance;
    const sign = difference >= 0 ? '+' : '-';
    return `${sign} ${new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: data.user.preferredCurrency,
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
    ].map((value) => Math.round(value * 100) / 100);
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

  protected forecastAccuracyLabel(accuracy: ForecastAccuracy) {
    const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(
      new Date(accuracy.targetDate),
    );
    const errorAbs = Math.abs(accuracy.errorPercent);
    const direction = accuracy.errorPercent >= 0 ? 'subestimou' : 'superestimou';
    return `Previsão de ${date} ${direction} o saldo em ${errorAbs.toFixed(1)}%`;
  }

  protected forecastAccuracyTone(accuracy: ForecastAccuracy): 'success' | 'warning' | 'danger' {
    const errorAbs = Math.abs(accuracy.errorPercent);
    if (errorAbs <= 10) return 'success';
    if (errorAbs <= 25) return 'warning';
    return 'danger';
  }

  protected formatCurrency(value: number, currencyCode: string) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currencyCode,
    }).format(value);
  }

  private loadSummary() {
    this.summarySubscription?.unsubscribe();
    clearTimeout(this.slowHintTimer);
    this.loadFailed.set(false);
    this.loadingSlow.set(false);
    this.slowHintTimer = setTimeout(() => this.loadingSlow.set(true), SLOW_HINT_AFTER_MS);

    this.summarySubscription = this.api
      .getDashboardSummary()
      .pipe(timeout(SUMMARY_TIMEOUT_MS))
      .subscribe({
        next: (summary) => {
          clearTimeout(this.slowHintTimer);
          this.loadingSlow.set(false);
          this.onboardingDismissed.set(readOnboardingDismissed(summary.user.id));
          this.summary.set(summary);
        },
        // Timeout ou erro do servidor: sem isto a tela ficava em "Carregando" para sempre.
        error: () => {
          clearTimeout(this.slowHintTimer);
          this.loadingSlow.set(false);
          this.loadFailed.set(true);
        },
      });
  }

  private shiftSpendingMonth(delta: number) {
    // Date normaliza a virada de ano (mes 0 / 13) sozinho.
    const target = new Date(this.spendingYear(), this.spendingMonth() - 1 + delta, 1);
    this.spendingMonth.set(target.getMonth() + 1);
    this.spendingYear.set(target.getFullYear());
    this.loadSpending();
  }

  private loadSpending() {
    const requestId = ++this.spendingRequestId;

    this.api
      .listTransactions({
        month: this.spendingMonth(),
        year: this.spendingYear(),
        type: 'EXPENSE',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((transactions) => {
        // Ignora resposta atrasada de um mes que o usuario ja deixou pra tras.
        if (requestId === this.spendingRequestId) {
          this.monthExpenses.set(transactions);
        }
      });
  }
}
