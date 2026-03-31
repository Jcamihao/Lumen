import { computed, effect, inject, Injectable, signal } from "@angular/core";
import {
  AssistantReply,
  DashboardSummary,
  Goal,
  Insight,
  Notification,
  Reminder,
  Task,
  Transaction,
  User,
} from "../models/domain.models";
import { formatLocalDateLabel, todayLocalInputValue } from "../utils/date.utils";
import { AuthService } from "./auth.service";

import { NativeStorageService } from "./native-storage.service";

type SyncEntity = "task" | "transaction" | "goal" | "user" | "reminder" | "notification";
type SyncAction = "create" | "update" | "delete" | "contribute" | "read";

type SyncQueueItem = {
  id: string;
  entity: SyncEntity;
  action: SyncAction;
  recordId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

type DashboardCache = Pick<
  DashboardSummary,
  "reminders" | "insights" | "forecast" | "notifications"
>;

@Injectable({ providedIn: "root" })
export class OfflineLifeService {
  private readonly authService = inject(AuthService);
  private readonly storageService = inject(NativeStorageService);
  private readonly queueSignal = signal<SyncQueueItem[]>([]);

  readonly pendingSyncCount = computed(() => this.queueSignal().length);

  constructor() {
    effect(() => {
      this.authService.currentUser()?.id;
      this.queueSignal.set(this.readScopedValue("sync-queue", [] as SyncQueueItem[]));
    });
  }

  hasPendingSync() {
    return this.queueSignal().length > 0;
  }

  getQueueSnapshot() {
    return [...this.queueSignal()];
  }

  removeQueueItem(id: string) {
    this.updateQueue((queue) => queue.filter((item) => item.id !== id));
  }

  replaceQueueRecordId(entity: SyncQueueItem["entity"], previousId: string, nextId: string) {
    this.updateQueue((queue) =>
      queue.map((item) =>
        item.entity === entity && item.recordId === previousId
          ? { ...item, recordId: nextId }
          : item,
      ),
    );
  }

  cacheDashboardSummary(summary: DashboardSummary) {
    this.writeScopedValue("dashboard-cache", {
      reminders: summary.reminders,
      insights: summary.insights,
      forecast: summary.forecast,
      notifications: summary.notifications,
    } satisfies DashboardCache);
    this.writeScopedValue("tasks", summary.tasks.items);
    this.writeScopedValue("transactions", summary.finances.recentTransactions);
    this.writeScopedValue("goals", summary.goals);
    this.writeScopedValue("reminders", summary.reminders);
    this.writeScopedValue("notifications", summary.notifications);
  }

  readDashboardSummary(): DashboardSummary {
    const user = this.authService.currentUser() ?? this.fallbackUser();
    const tasks = this.readTasks();
    const transactions = this.readTransactions();
    const goals = this.readGoals();
    const cache = this.readScopedValue("dashboard-cache", {
      reminders: [] as Reminder[],
      insights: [] as Insight[],
      forecast: {
        id: "offline-forecast",
        predictedBalance: 0,
        riskLevel: "LOW" as const,
      },
      notifications: [] as Notification[],
    } satisfies DashboardCache);

    const balance = this.balanceFromTransactions(transactions);
    const monthIncome = this.monthTotal(transactions, "INCOME");
    const monthExpenses = this.monthTotal(transactions, "EXPENSE") + this.monthTotal(transactions, "TRANSFER");
    const todayCount = this.tasksForToday(tasks).length;
    const overdueCount = this.overdueTasks(tasks).length;
    const pendingTaskCost = tasks
      .filter((task) => task.status !== "DONE")
      .reduce((sum, task) => sum + Number(task.estimatedAmount ?? 0), 0);
    const predictedBalance = balance - pendingTaskCost;
    const riskLevel =
      predictedBalance < 0
        ? "HIGH"
        : monthExpenses > monthIncome && monthIncome > 0
          ? "MEDIUM"
          : "LOW";

    return {
      user: {
        id: user.id,
        name: user.name,
        preferredCurrency: user.preferredCurrency,
        monthlyIncome: user.monthlyIncome,
      },
      tasks: {
        todayCount,
        overdueCount,
        items: tasks,
      },
      finances: {
        balance,
        monthlyExpenses: monthExpenses,
        monthlyIncome: monthIncome,
        recentTransactions: transactions.slice(0, 8),
      },
      goals,
      reminders: this.readReminders(cache.reminders ?? []),
      insights: this.buildInsights(tasks, transactions, goals, cache.insights ?? []),
      forecast: {
        id: cache.forecast?.id ?? "offline-forecast",
        predictedBalance,
        riskLevel,
      },
      notifications: this.readNotifications(cache.notifications ?? []),
    };
  }

  readTasks() {
    return this.sortTasks(this.readScopedValue("tasks", [] as Task[]));
  }

  cacheTasks(tasks: Task[]) {
    this.writeScopedValue("tasks", this.sortTasks(tasks));
  }

  queueTaskCreate(payload: Record<string, unknown>) {
    const task = this.buildOfflineTask(payload);
    this.cacheTasks([task, ...this.readTasks()]);
    this.enqueue({
      entity: "task",
      action: "create",
      recordId: task.id,
      payload,
    });
    return task;
  }

  queueTaskUpdate(id: string, payload: Record<string, unknown>) {
    const tasks = this.readTasks().map((task) =>
      task.id === id
        ? this.applyTaskPatch(task, payload)
        : task,
    );
    this.cacheTasks(tasks);

    if (this.mergeIntoPendingCreate("task", id, payload)) {
      return tasks.find((task) => task.id === id) ?? null;
    }

    this.enqueue({
      entity: "task",
      action: "update",
      recordId: id,
      payload,
    });

    return tasks.find((task) => task.id === id) ?? null;
  }

  queueTaskDelete(id: string) {
    this.cacheTasks(this.readTasks().filter((task) => task.id !== id));

    if (this.dropPendingCreateChain("task", id)) {
      return { success: true };
    }

    this.dropPendingMutations("task", id);
    this.enqueue({
      entity: "task",
      action: "delete",
      recordId: id,
    });
    return { success: true };
  }

  reconcileTask(remoteTask: Task, previousId?: string) {
    const tasks = this.readTasks();
    const nextTasks = previousId
      ? tasks.map((task) => (task.id === previousId ? remoteTask : task))
      : this.upsertById(tasks, remoteTask);

    this.cacheTasks(nextTasks);

    if (previousId && previousId !== remoteTask.id) {
      this.replaceQueueRecordId("task", previousId, remoteTask.id);
    }
  }

  readTransactions() {
    return this.sortTransactions(this.readScopedValue("transactions", [] as Transaction[]));
  }

  cacheTransactions(transactions: Transaction[]) {
    this.writeScopedValue("transactions", this.sortTransactions(transactions));
  }

  queueTransactionCreate(payload: Record<string, unknown>) {
    const transaction = this.buildOfflineTransaction(payload);
    this.cacheTransactions([transaction, ...this.readTransactions()]);
    this.enqueue({
      entity: "transaction",
      action: "create",
      recordId: transaction.id,
      payload,
    });
    return transaction;
  }

  queueTransactionUpdate(id: string, payload: Record<string, unknown>) {
    const transactions = this.readTransactions().map((transaction) =>
      transaction.id === id
        ? this.applyTransactionPatch(transaction, payload)
        : transaction,
    );
    this.cacheTransactions(transactions);

    if (this.mergeIntoPendingCreate("transaction", id, payload)) {
      return transactions.find((transaction) => transaction.id === id) ?? null;
    }

    this.enqueue({
      entity: "transaction",
      action: "update",
      recordId: id,
      payload,
    });

    return transactions.find((transaction) => transaction.id === id) ?? null;
  }

  queueTransactionDelete(id: string) {
    this.cacheTransactions(
      this.readTransactions().filter((transaction) => transaction.id !== id),
    );

    if (this.dropPendingCreateChain("transaction", id)) {
      return { success: true };
    }

    this.dropPendingMutations("transaction", id);
    this.enqueue({
      entity: "transaction",
      action: "delete",
      recordId: id,
    });
    return { success: true };
  }

  reconcileTransaction(remoteTransaction: Transaction, previousId?: string) {
    const transactions = this.readTransactions();
    const nextTransactions = previousId
      ? transactions.map((transaction) =>
          transaction.id === previousId ? remoteTransaction : transaction,
        )
      : this.upsertById(transactions, remoteTransaction);

    this.cacheTransactions(nextTransactions);

    if (previousId && previousId !== remoteTransaction.id) {
      this.replaceQueueRecordId("transaction", previousId, remoteTransaction.id);
    }
  }

  readGoals() {
    return this.sortGoals(this.readScopedValue("goals", [] as Goal[]));
  }

  cacheGoals(goals: Goal[]) {
    this.writeScopedValue("goals", this.sortGoals(goals));
  }

  queueGoalCreate(payload: Record<string, unknown>) {
    const goal = this.buildOfflineGoal(payload);
    this.cacheGoals([goal, ...this.readGoals()]);
    this.enqueue({
      entity: "goal",
      action: "create",
      recordId: goal.id,
      payload,
    });
    return goal;
  }

  queueGoalContribute(id: string, payload: Record<string, unknown>) {
    const amount = Number(payload["amount"] ?? 0);
    const goals = this.readGoals().map((goal) =>
      goal.id === id
        ? {
            ...goal,
            currentAmount: goal.currentAmount + amount,
            status:
              goal.currentAmount + amount >= goal.targetAmount
                ? "ACHIEVED"
                : goal.status,
          }
        : goal,
    );
    this.cacheGoals(goals);

    const currentGoal = goals.find((goal) => goal.id === id) ?? null;

    if (this.mergeIntoPendingCreate("goal", id, { currentAmount: currentGoal?.currentAmount ?? amount })) {
      return currentGoal;
    }

    this.enqueue({
      entity: "goal",
      action: "contribute",
      recordId: id,
      payload,
    });

    return currentGoal;
  }

  queueGoalUpdate(id: string, payload: Record<string, unknown>) {
    const goals = this.readGoals().map((goal) =>
      goal.id === id
        ? this.applyGoalPatch(goal, payload)
        : goal,
    );
    this.cacheGoals(goals);

    if (this.mergeIntoPendingCreate("goal", id, payload)) {
      return goals.find((goal) => goal.id === id) ?? null;
    }

    this.enqueue({
      entity: "goal",
      action: "update",
      recordId: id,
      payload,
    });

    return goals.find((goal) => goal.id === id) ?? null;
  }

  queueGoalDelete(id: string) {
    this.cacheGoals(this.readGoals().filter((goal) => goal.id !== id));

    if (this.dropPendingCreateChain("goal", id)) {
      return { success: true };
    }

    this.dropPendingMutations("goal", id);
    this.enqueue({
      entity: "goal",
      action: "delete",
      recordId: id,
    });
    return { success: true };
  }

  reconcileGoal(remoteGoal: Goal, previousId?: string) {
    const goals = this.readGoals();
    const nextGoals = previousId
      ? goals.map((goal) => (goal.id === previousId ? remoteGoal : goal))
      : this.upsertById(goals, remoteGoal);

    this.cacheGoals(nextGoals);

    if (previousId && previousId !== remoteGoal.id) {
      this.replaceQueueRecordId("goal", previousId, remoteGoal.id);
    }
  }

  readReminders(fallback: Reminder[] = []) {
    return this.sortReminders(this.readScopedValue("reminders", fallback));
  }

  cacheReminders(reminders: Reminder[]) {
    this.writeScopedValue("reminders", this.sortReminders(reminders));
  }

  queueReminderCreate(payload: Record<string, unknown>) {
    const reminder = this.buildOfflineReminder(payload);
    this.cacheReminders([reminder, ...this.readReminders()]);
    this.enqueue({
      entity: "reminder",
      action: "create",
      recordId: reminder.id,
      payload,
    });
    return reminder;
  }

  queueReminderUpdate(id: string, payload: Record<string, unknown>) {
    const reminders = this.readReminders().map((reminder) =>
      reminder.id === id
        ? this.applyReminderPatch(reminder, payload)
        : reminder,
    );
    this.cacheReminders(reminders);

    if (this.mergeIntoPendingCreate("reminder", id, payload)) {
      return reminders.find((reminder) => reminder.id === id) ?? null;
    }

    this.enqueue({
      entity: "reminder",
      action: "update",
      recordId: id,
      payload,
    });

    return reminders.find((reminder) => reminder.id === id) ?? null;
  }

  queueReminderDelete(id: string) {
    this.cacheReminders(this.readReminders().filter((reminder) => reminder.id !== id));

    if (this.dropPendingCreateChain("reminder", id)) {
      return { success: true };
    }

    this.dropPendingMutations("reminder", id);
    this.enqueue({
      entity: "reminder",
      action: "delete",
      recordId: id,
    });
    return { success: true };
  }

  reconcileReminder(remoteReminder: Reminder, previousId?: string) {
    const reminders = this.readReminders();
    const nextReminders = previousId
      ? reminders.map((reminder) =>
          reminder.id === previousId ? remoteReminder : reminder,
        )
      : this.upsertById(reminders, remoteReminder);

    this.cacheReminders(nextReminders);

    if (previousId && previousId !== remoteReminder.id) {
      this.replaceQueueRecordId("reminder", previousId, remoteReminder.id);
    }
  }

  readNotifications(fallback: Notification[] = []) {
    return this.readScopedValue("notifications", fallback);
  }

  cacheNotifications(notifications: Notification[]) {
    this.writeScopedValue("notifications", notifications);
  }

  queueNotificationRead(id: string) {
    const notifications = this.readNotifications().map((notification) =>
      notification.id === id
        ? { ...notification, isRead: true }
        : notification,
    );
    this.cacheNotifications(notifications);

    this.dropPendingMutations("notification", id);
    this.enqueue({
      entity: "notification",
      action: "read",
      recordId: id,
    });
    return { success: true };
  }

  queueUserUpdate(payload: Record<string, unknown>) {
    const currentUser = this.authService.currentUser() ?? this.fallbackUser();
    const nextUser: User = {
      ...currentUser,
      ...payload,
    } as User;

    this.authService.updateStoredUser(nextUser);

    const existingUserUpdate = this.queueSignal().find(
      (item) => item.entity === "user" && item.action === "update",
    );

    if (existingUserUpdate) {
      this.updateQueue((queue) =>
        queue.map((item) =>
          item.id === existingUserUpdate.id
            ? {
                ...item,
                payload: {
                  ...(item.payload ?? {}),
                  ...payload,
                },
              }
            : item,
        ),
      );
      return nextUser;
    }

    this.enqueue({
      entity: "user",
      action: "update",
      payload,
    });
    return nextUser;
  }

  reconcileUser(remoteUser: User) {
    this.authService.updateStoredUser(remoteUser);
  }

  buildOfflineAssistantReply(question: string): AssistantReply {
    const summary = this.readDashboardSummary();
    const intent = this.detectIntent(question);
    const currency = summary.user.preferredCurrency;
    const topTask = summary.tasks.items[0];
    const topExpense = summary.finances.recentTransactions.find(
      (transaction) => transaction.type === "EXPENSE",
    );
    const topGoal = summary.goals[0];
    const answer =
      intent === "finance_overview"
        ? `Offline agora: seu saldo local está em ${this.formatCurrency(summary.finances.balance, currency)} e a projeção local aponta ${this.formatCurrency(summary.forecast.predictedBalance, currency)}.`
        : intent === "priorities"
          ? topTask
            ? `Offline agora, eu começaria por ${topTask.title}, porque ela concentra o próximo passo mais concreto do seu fluxo local.`
            : `Offline agora, sua fila local não mostra uma prioridade dominante.`
          : `Offline agora, você tem ${summary.tasks.todayCount} tarefa(s) para hoje, ${summary.tasks.overdueCount} atrasada(s) e saldo local em ${this.formatCurrency(summary.finances.balance, currency)}.`;

    const highlights = [
      topTask ? `Tarefa em foco: ${topTask.title}.` : null,
      topExpense
        ? `Movimentação recente: ${topExpense.description} em ${this.formatCurrency(topExpense.amount, currency)}.`
        : null,
      topGoal ? `Meta em andamento: ${topGoal.title}, ${this.goalProgress(topGoal)}% concluída.` : null,
      summary.forecast.riskLevel === "HIGH"
        ? "O cálculo local sinaliza risco alto para o caixa."
        : "O cálculo local não sinaliza risco crítico agora.",
    ].filter((item): item is string => Boolean(item)).slice(0, 4);

    const suggestedActions = [
      topTask ? `Feche ${topTask.title} antes de abrir novas demandas.` : null,
      topExpense ? `Revise ${topExpense.description} no fluxo financeiro.` : null,
      topGoal ? `Reforce ${topGoal.title} com um aporte ou revisão de prazo.` : null,
      "Volte a ficar online para sincronizar as mudanças com o servidor.",
    ].filter((item): item is string => Boolean(item)).slice(0, 4);

    return {
      answer,
      highlights,
      suggestedActions,
      source: "lumen_fallback",
      provider: "LUMEN Offline",
      focusArea:
        intent === "finance_overview"
          ? "Financeiro"
          : intent === "priorities"
            ? "Prioridades"
            : "Panorama",
      confidence: "medium",
      disclaimer:
        "Resposta gerada offline com base nos dados locais do dispositivo. Assim que a conexão voltar, o LUMEN sincroniza e pode refinar essa leitura.",
      generatedAt: new Date().toISOString(),
    };
  }

  private buildOfflineTask(payload: Record<string, unknown>): Task {
    return {
      id: this.tempId("task"),
      title: String(payload["title"] || "Nova tarefa"),
      description: this.optionalString(payload["description"]),
      dueDate: this.optionalString(payload["dueDate"]),
      status: "PENDING",
      priority: (payload["priority"] as Task["priority"]) || "MEDIUM",
      hasFinancialImpact: Boolean(payload["hasFinancialImpact"]),
      estimatedAmount: this.optionalNumber(payload["estimatedAmount"]),
      category: this.resolveTaskCategory(this.optionalString(payload["categoryId"])),
      subtasks: [],
    };
  }

  private buildOfflineTransaction(payload: Record<string, unknown>): Transaction {
    const type = (payload["type"] as Transaction["type"]) || "EXPENSE";
    return {
      id: this.tempId("transaction"),
      description: String(payload["description"] || "Nova transação"),
      type,
      amount: Math.abs(Number(payload["amount"] || 0)),
      date: String(payload["date"] || todayLocalInputValue()),
      category: this.resolveFinanceCategory(this.optionalString(payload["categoryId"]), type),
    };
  }

  private buildOfflineGoal(payload: Record<string, unknown>): Goal {
    return {
      id: this.tempId("goal"),
      title: String(payload["title"] || "Nova meta"),
      description: this.optionalString(payload["description"]),
      targetAmount: Number(payload["targetAmount"] || 0),
      currentAmount: Number(payload["currentAmount"] || 0),
      targetDate: this.optionalString(payload["targetDate"]),
      status: "ACTIVE",
    };
  }

  private buildOfflineReminder(payload: Record<string, unknown>): Reminder {
    return {
      id: this.tempId("reminder"),
      title: String(payload["title"] || "Novo lembrete"),
      remindAt: String(payload["remindAt"] || new Date().toISOString()),
    };
  }

  private applyTaskPatch(task: Task, payload: Record<string, unknown>): Task {
    return {
      ...task,
      title:
        typeof payload["title"] === "string" ? String(payload["title"]) : task.title,
      description:
        payload["description"] !== undefined
          ? this.optionalString(payload["description"])
          : task.description,
      dueDate:
        payload["dueDate"] !== undefined
          ? this.optionalString(payload["dueDate"])
          : task.dueDate,
      status: (payload["status"] as Task["status"]) || task.status,
      priority: (payload["priority"] as Task["priority"]) || task.priority,
      hasFinancialImpact:
        payload["hasFinancialImpact"] !== undefined
          ? Boolean(payload["hasFinancialImpact"])
          : task.hasFinancialImpact,
      estimatedAmount:
        payload["estimatedAmount"] !== undefined
          ? this.optionalNumber(payload["estimatedAmount"])
          : task.estimatedAmount,
      category:
        payload["categoryId"] !== undefined
          ? this.resolveTaskCategory(this.optionalString(payload["categoryId"]))
          : task.category,
    };
  }

  private applyTransactionPatch(
    transaction: Transaction,
    payload: Record<string, unknown>,
  ): Transaction {
    const nextType =
      (payload["type"] as Transaction["type"] | undefined) ?? transaction.type;

    return {
      ...transaction,
      description:
        typeof payload["description"] === "string"
          ? String(payload["description"])
          : transaction.description,
      type: nextType,
      amount:
        payload["amount"] !== undefined
          ? Math.abs(Number(payload["amount"] || 0))
          : transaction.amount,
      date:
        payload["date"] !== undefined
          ? String(payload["date"] || transaction.date)
          : transaction.date,
      category:
        payload["categoryId"] !== undefined
          ? this.resolveFinanceCategory(
              this.optionalString(payload["categoryId"]),
              nextType,
            )
          : transaction.category,
    };
  }

  private applyGoalPatch(goal: Goal, payload: Record<string, unknown>): Goal {
    return {
      ...goal,
      title:
        typeof payload["title"] === "string" ? String(payload["title"]) : goal.title,
      description:
        payload["description"] !== undefined
          ? this.optionalString(payload["description"])
          : goal.description,
      targetAmount:
        payload["targetAmount"] !== undefined
          ? Number(payload["targetAmount"] || 0)
          : goal.targetAmount,
      currentAmount:
        payload["currentAmount"] !== undefined
          ? Number(payload["currentAmount"] || 0)
          : goal.currentAmount,
      targetDate:
        payload["targetDate"] !== undefined
          ? this.optionalString(payload["targetDate"])
          : goal.targetDate,
      status:
        (payload["status"] as Goal["status"] | undefined) ?? goal.status,
    };
  }

  private applyReminderPatch(
    reminder: Reminder,
    payload: Record<string, unknown>,
  ): Reminder {
    return {
      ...reminder,
      title:
        typeof payload["title"] === "string"
          ? String(payload["title"])
          : reminder.title,
      remindAt:
        payload["remindAt"] !== undefined
          ? String(payload["remindAt"] || reminder.remindAt)
          : reminder.remindAt,
    };
  }

  private buildInsights(
    tasks: Task[],
    transactions: Transaction[],
    goals: Goal[],
    cachedInsights: Insight[],
  ) {
    const generated: Insight[] = [];

    if (this.overdueTasks(tasks).length) {
      generated.push({
        id: "offline-insight-overdue",
        type: "PRODUCTIVITY",
        severity: "WARNING",
        message: `${this.overdueTasks(tasks).length} tarefa(s) seguem atrasadas no modo offline.`,
      });
    }

    const monthIncome = this.monthTotal(transactions, "INCOME");
    const monthExpenses = this.monthTotal(transactions, "EXPENSE") + this.monthTotal(transactions, "TRANSFER");
    if (monthExpenses > monthIncome && monthExpenses > 0) {
      generated.push({
        id: "offline-insight-balance",
        type: "FINANCE",
        severity: "WARNING",
        message: "As saídas locais do mês já superam as entradas registradas.",
      });
    }

    const stalledGoal = goals.find((goal) => this.goalProgress(goal) < 25);
    if (stalledGoal) {
      generated.push({
        id: "offline-insight-goal",
        type: "GOAL",
        severity: "INFO",
        message: `${stalledGoal.title} ainda tem pouco avanço e pode pedir um reforço local.`,
      });
    }

    return [...generated, ...cachedInsights].slice(0, 5);
  }

  private balanceFromTransactions(transactions: Transaction[]) {
    return transactions.reduce((sum, transaction) => {
      if (transaction.type === "INCOME") {
        return sum + transaction.amount;
      }

      return sum - transaction.amount;
    }, 0);
  }

  private monthTotal(transactions: Transaction[], type: Transaction["type"]) {
    const now = new Date();
    return transactions
      .filter((transaction) => {
        const transactionDate = new Date(transaction.date);
        return (
          transaction.type === type &&
          transactionDate.getMonth() === now.getMonth() &&
          transactionDate.getFullYear() === now.getFullYear()
        );
      })
      .reduce((sum, transaction) => sum + transaction.amount, 0);
  }

  private tasksForToday(tasks: Task[]) {
    const today = todayLocalInputValue();
    return tasks.filter((task) => task.dueDate?.slice(0, 10) === today);
  }

  private overdueTasks(tasks: Task[]) {
    const today = todayLocalInputValue();
    return tasks.filter(
      (task) =>
        task.status !== "DONE" &&
        Boolean(task.dueDate) &&
        String(task.dueDate).slice(0, 10) < today,
    );
  }

  private goalProgress(goal: Goal) {
    if (!goal.targetAmount) {
      return 0;
    }

    return Math.max(
      0,
      Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)),
    );
  }

  private detectIntent(question: string) {
    const normalized = question.toLowerCase();

    if (normalized.includes("prioriz")) {
      return "priorities" as const;
    }

    if (
      normalized.includes("finance") ||
      normalized.includes("saldo") ||
      normalized.includes("dinheiro")
    ) {
      return "finance_overview" as const;
    }

    return "today_overview" as const;
  }

  private resolveTaskCategory(categoryId?: string | null) {
    return (
      this.authService
        .currentUser()
        ?.taskCategories.find((category) => category.id === categoryId) ?? null
    );
  }

  private resolveFinanceCategory(
    categoryId?: string | null,
    type?: Transaction["type"],
  ) {
    return (
      this.authService
        .currentUser()
        ?.financeCategories.find(
          (category) =>
            category.id === categoryId &&
            (!type || category.type === type),
        ) ?? null
    );
  }

  private enqueue(item: Omit<SyncQueueItem, "id" | "createdAt">) {
    this.updateQueue((queue) => [
      ...queue,
      {
        id: this.tempId("sync"),
        createdAt: new Date().toISOString(),
        ...item,
      },
    ]);
  }

  private mergeIntoPendingCreate(
    entity: SyncEntity,
    recordId: string,
    payload: Record<string, unknown>,
  ) {
    let merged = false;

    this.updateQueue((queue) =>
      queue.map((item) => {
        if (
          item.entity === entity &&
          item.action === "create" &&
          item.recordId === recordId
        ) {
          merged = true;
          return {
            ...item,
            payload: {
              ...(item.payload ?? {}),
              ...payload,
            },
          };
        }

        return item;
      }),
    );

    return merged;
  }

  private dropPendingCreateChain(
    entity: SyncEntity,
    recordId: string,
  ) {
    const before = this.queueSignal().length;
    this.updateQueue((queue) =>
      queue.filter(
        (item) =>
          !(
            item.entity === entity &&
            item.recordId === recordId &&
            (item.action === "create" ||
              item.action === "update" ||
              item.action === "contribute")
          ),
      ),
    );
    return this.queueSignal().length !== before;
  }

  private dropPendingMutations(
    entity: SyncEntity,
    recordId: string,
  ) {
    this.updateQueue((queue) =>
      queue.filter(
        (item) =>
          !(
            item.entity === entity &&
            item.recordId === recordId &&
            item.action !== "create"
          ),
      ),
    );
  }

  private updateQueue(mutator: (queue: SyncQueueItem[]) => SyncQueueItem[]) {
    const nextQueue = mutator([...this.queueSignal()]);
    this.queueSignal.set(nextQueue);
    this.writeScopedValue("sync-queue", nextQueue);
  }

  private upsertById<T extends { id: string }>(items: T[], candidate: T) {
    const existingIndex = items.findIndex((item) => item.id === candidate.id);

    if (existingIndex === -1) {
      return [candidate, ...items];
    }

    const nextItems = [...items];
    nextItems[existingIndex] = candidate;
    return nextItems;
  }

  private sortTasks(tasks: Task[]) {
    return [...tasks].sort((left, right) => {
      const leftDue = left.dueDate ? new Date(left.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDue = right.dueDate ? new Date(right.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      return leftDue - rightDue;
    });
  }

  private sortTransactions(transactions: Transaction[]) {
    return [...transactions].sort(
      (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
    );
  }

  private sortGoals(goals: Goal[]) {
    return [...goals].sort((left, right) => {
      const leftAchieved = left.status === "ACHIEVED" ? 1 : 0;
      const rightAchieved = right.status === "ACHIEVED" ? 1 : 0;

      if (leftAchieved !== rightAchieved) {
        return leftAchieved - rightAchieved;
      }

      const leftDate = left.targetDate ? new Date(left.targetDate).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDate = right.targetDate ? new Date(right.targetDate).getTime() : Number.MAX_SAFE_INTEGER;
      return leftDate - rightDate;
    });
  }

  private sortReminders(reminders: Reminder[]) {
    return [...reminders].sort(
      (left, right) =>
        new Date(left.remindAt).getTime() - new Date(right.remindAt).getTime(),
    );
  }

  private formatCurrency(amount: number, currency: string) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  private readScopedValue<T>(name: string, fallback: T): T {
    try {
      const raw = this.storageService.getItem(this.scopedKey(name));
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private writeScopedValue<T>(name: string, value: T) {
    try {
      this.storageService.setItem(this.scopedKey(name), JSON.stringify(value));
    } catch {
      // Ignore storage quota issues.
    }
  }

  private scopedKey(name: string) {
    return `lumen:offline:${this.authService.currentUser()?.id ?? "anonymous"}:${name}`;
  }

  private tempId(prefix: string) {
    return `offline-${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  }

  private optionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private optionalNumber(value: unknown) {
    return value === null || value === undefined || value === ""
      ? null
      : Number(value);
  }

  private fallbackUser(): User {
    return {
      id: "offline-user",
      name: "Você",
      email: "offline@lumen.local",
      preferredCurrency: "BRL",
      monthlyIncome: 0,
      monthClosingDay: 30,
      timezone: "America/Sao_Paulo",
      taskCategories: [],
      financeCategories: [],
    };
  }
}
