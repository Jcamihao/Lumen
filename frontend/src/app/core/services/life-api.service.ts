import { HttpClient } from "@angular/common/http";
import { computed, effect, inject, Injectable, signal } from "@angular/core";
import { firstValueFrom, map, Observable, of, tap } from "rxjs";
import { environment } from "../../../environments/environment";
import {
  AssistantAction,
  AssistantHistoryTurn,
  AssistantPulse,
  AssistantReply,
  DashboardSummary,
  FinanceCategory,
  FeedbackSummary,
  CreditCycle,
  CreditCard,
  CreditCardInput,
  CreditCardReceipt,
  Envelope,
  ForecastAccuracy,
  Goal,
  GoalContribution,
  ImportJobHistoryEntry,
  ImportPreview,
  Insight,
  InstallmentPurchase,
  Notification,
  PaymentMethod,
  PrivacyExportPayload,
  ReceiptImportCommitResponse,
  ReceiptImportPreview,
  ReceiptScanHistoryEntry,
  RecurrenceFrequency,
  RecurringTransaction,
  Reminder,
  TagGroup,
  SupportRequest,
  Task,
  Transaction,
  User,
} from "../models/domain.models";
import { NetworkService } from "./network.service";
import { OfflineLifeService } from "./offline-life.service";

@Injectable({ providedIn: "root" })
export class LifeApiService {
  private readonly http = inject(HttpClient);
  private readonly networkService = inject(NetworkService);
  private readonly offlineLifeService = inject(OfflineLifeService);
  private readonly syncInFlight = signal(false);

  readonly offlineMode = computed(() => !this.networkService.isOnline());
  readonly pendingSyncCount = this.offlineLifeService.pendingSyncCount;
  readonly failedSyncCount = this.offlineLifeService.failedSyncCount;
  readonly activeSyncItemCount = this.offlineLifeService.activeSyncItemCount;
  readonly syncQueueItems = this.offlineLifeService.syncQueueItems;
  readonly syncing = this.syncInFlight.asReadonly();

  constructor() {
    effect(() => {
      if (
        this.networkService.isOnline() &&
        this.offlineLifeService.pendingSyncCount() > 0
      ) {
        queueMicrotask(() => {
          void this.flushPendingSync();
        });
      }
    });
  }

  retryFailedSync() {
    this.offlineLifeService.resetFailedQueueItems();

    if (this.networkService.isOnline()) {
      queueMicrotask(() => {
        void this.flushPendingSync();
      });
    }
  }

  getDashboardSummary() {
    if (!this.networkService.isOnline() || this.offlineLifeService.hasPendingSync()) {
      void this.flushPendingSync();
      return of(this.offlineLifeService.readDashboardSummary());
    }

    return this.http
      .get<DashboardSummary>(`${environment.apiBaseUrl}/dashboard/summary`)
      .pipe(
        tap((summary) => this.offlineLifeService.cacheDashboardSummary(summary)),
        this.withOfflineFallback(() => this.offlineLifeService.readDashboardSummary()),
      );
  }

  getAssistantPulse() {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.buildOfflineAssistantPulse());
    }

    return this.http.get<AssistantPulse>(`${environment.apiBaseUrl}/assistant/pulse`).pipe(
      this.withOfflineFallback(() => this.offlineLifeService.buildOfflineAssistantPulse()),
    );
  }

  /**
   * So-mente leitura — insights sao computados pelo backend, nao ha fila de
   * sincronizacao offline pra eles (nao ha o que reenviar). Sem rede, volta
   * lista vazia em vez de quebrar quem consome (ex.: busca global).
   */
  listInsights() {
    if (!this.networkService.isOnline()) {
      return of([] as Insight[]);
    }

    return this.http.get<Insight[]>(`${environment.apiBaseUrl}/insights`).pipe(
      this.withOfflineFallback(() => [] as Insight[]),
    );
  }

  /**
   * Ultima previsao ja conferida contra o saldo real (backend so preenche
   * apos o targetDate de 30 dias passar). Null enquanto nao houver nenhuma
   * ainda — nao ha cache offline porque nao ha nada util a mostrar sem rede.
   */
  getForecastAccuracy() {
    if (!this.networkService.isOnline()) {
      return of(null as ForecastAccuracy | null);
    }

    return this.http
      .get<ForecastAccuracy | null>(`${environment.apiBaseUrl}/forecasts/accuracy`)
      .pipe(this.withOfflineFallback(() => null as ForecastAccuracy | null));
  }

  listTasks() {
    if (!this.networkService.isOnline() || this.offlineLifeService.hasPendingSync()) {
      void this.flushPendingSync();
      return of(this.offlineLifeService.readTasks());
    }

    return this.http.get<Task[]>(`${environment.apiBaseUrl}/tasks`).pipe(
      tap((tasks) => this.offlineLifeService.cacheTasks(tasks)),
      this.withOfflineFallback(() => this.offlineLifeService.readTasks()),
    );
  }

  createTask(payload: Record<string, unknown>) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueTaskCreate(payload));
    }

    return this.http.post<Task>(`${environment.apiBaseUrl}/tasks`, payload).pipe(
      tap((task) => this.offlineLifeService.reconcileTask(task)),
      this.withMutationOfflineFallback(() => this.offlineLifeService.queueTaskCreate(payload)),
    );
  }

  updateTask(id: string, payload: Record<string, unknown>) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueTaskUpdate(id, payload) as Task);
    }

    return this.http.patch<Task>(`${environment.apiBaseUrl}/tasks/${id}`, payload).pipe(
      tap((task) => this.offlineLifeService.reconcileTask(task, id.startsWith("offline-") ? id : undefined)),
      this.withMutationOfflineFallback(
        () => this.offlineLifeService.queueTaskUpdate(id, payload) as Task,
      ),
    );
  }

  deleteTask(id: string) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueTaskDelete(id));
    }

    return this.http.delete<{ success: boolean }>(`${environment.apiBaseUrl}/tasks/${id}`).pipe(
      this.withMutationOfflineFallback(() => this.offlineLifeService.queueTaskDelete(id)),
    );
  }

  listTransactions(params?: {
    month?: number;
    year?: number;
    type?: string;
    search?: string;
    paymentMethod?: string;
    envelopeId?: string;
    cardId?: string;
  }) {
    if (!this.networkService.isOnline() || this.offlineLifeService.hasPendingSync()) {
      void this.flushPendingSync();
      return of(this.offlineLifeService.readTransactions());
    }

    const httpParams: Record<string, string> = {};
    if (params?.month) httpParams['month'] = String(params.month);
    if (params?.year) httpParams['year'] = String(params.year);
    if (params?.type) httpParams['type'] = params.type;
    if (params?.search) httpParams['search'] = params.search;
    if (params?.paymentMethod) httpParams['paymentMethod'] = params.paymentMethod;
    if (params?.envelopeId) httpParams['envelopeId'] = params.envelopeId;
    if (params?.cardId) httpParams['cardId'] = params.cardId;

    return this.http
      .get<Transaction[]>(`${environment.apiBaseUrl}/transactions`, { params: httpParams })
      .pipe(
        tap((transactions) => this.offlineLifeService.cacheTransactions(transactions)),
        this.withOfflineFallback(() => this.offlineLifeService.readTransactions()),
      );
  }

  createTransaction(payload: Record<string, unknown>) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueTransactionCreate(payload));
    }

    return this.http
      .post<Transaction>(`${environment.apiBaseUrl}/transactions`, payload)
      .pipe(
        tap((transaction) => this.offlineLifeService.reconcileTransaction(transaction)),
        this.withMutationOfflineFallback(() =>
          this.offlineLifeService.queueTransactionCreate(payload),
        ),
      );
  }

  updateTransaction(id: string, payload: Record<string, unknown>) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueTransactionUpdate(id, payload) as Transaction);
    }

    return this.http.patch<Transaction>(`${environment.apiBaseUrl}/transactions/${id}`, payload).pipe(
      tap((transaction) =>
        this.offlineLifeService.reconcileTransaction(
          transaction,
          id.startsWith("offline-") ? id : undefined,
        ),
      ),
      this.withMutationOfflineFallback(
        () => this.offlineLifeService.queueTransactionUpdate(id, payload) as Transaction,
      ),
    );
  }

  deleteTransaction(id: string) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueTransactionDelete(id));
    }

    return this.http.delete<{ success: boolean }>(`${environment.apiBaseUrl}/transactions/${id}`).pipe(
      this.withMutationOfflineFallback(() => this.offlineLifeService.queueTransactionDelete(id)),
    );
  }

  listGoals() {
    if (!this.networkService.isOnline() || this.offlineLifeService.hasPendingSync()) {
      void this.flushPendingSync();
      return of(this.offlineLifeService.readGoals());
    }

    return this.http.get<Goal[]>(`${environment.apiBaseUrl}/goals`).pipe(
      tap((goals) => this.offlineLifeService.cacheGoals(goals)),
      this.withOfflineFallback(() => this.offlineLifeService.readGoals()),
    );
  }

  createGoal(payload: Record<string, unknown>) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueGoalCreate(payload));
    }

    return this.http.post<Goal>(`${environment.apiBaseUrl}/goals`, payload).pipe(
      tap((goal) => this.offlineLifeService.reconcileGoal(goal)),
      this.withMutationOfflineFallback(() => this.offlineLifeService.queueGoalCreate(payload)),
    );
  }

  updateGoal(id: string, payload: Record<string, unknown>) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueGoalUpdate(id, payload) as Goal);
    }

    return this.http.patch<Goal>(`${environment.apiBaseUrl}/goals/${id}`, payload).pipe(
      tap((goal) =>
        this.offlineLifeService.reconcileGoal(goal, id.startsWith("offline-") ? id : undefined),
      ),
      this.withMutationOfflineFallback(
        () => this.offlineLifeService.queueGoalUpdate(id, payload) as Goal,
      ),
    );
  }

  /**
   * So online de proposito: um saque enfileirado offline poderia entrar em
   * corrida com um deposito tambem enfileirado e deixar o saldo local
   * inconsistente. Falha e pede pra tentar de novo quando a rede voltar.
   */
  withdrawGoal(id: string, payload: Record<string, unknown>) {
    return this.http
      .patch<Goal>(`${environment.apiBaseUrl}/goals/${id}/withdraw`, payload)
      .pipe(tap((goal) => this.offlineLifeService.reconcileGoal(goal)));
  }

  contributeGoal(id: string, payload: Record<string, unknown>) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueGoalContribute(id, payload) as Goal);
    }

    return this.http
      .patch<Goal>(`${environment.apiBaseUrl}/goals/${id}/contribute`, payload)
      .pipe(
        tap((goal) => this.offlineLifeService.reconcileGoal(goal, id.startsWith("offline-") ? id : undefined)),
        this.withMutationOfflineFallback(
          () => this.offlineLifeService.queueGoalContribute(id, payload) as Goal,
        ),
      );
  }

  deleteGoal(id: string) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueGoalDelete(id));
    }

    return this.http.delete<{ success: boolean }>(`${environment.apiBaseUrl}/goals/${id}`).pipe(
      this.withMutationOfflineFallback(() => this.offlineLifeService.queueGoalDelete(id)),
    );
  }

  listGoalContributions(goalId: string) {
    return this.http.get<GoalContribution[]>(
      `${environment.apiBaseUrl}/goals/${goalId}/contributions`,
    );
  }

  askAssistant(
    question: string,
    options?: {
      originModule?: string | null;
      history?: Array<{
        question: string;
        answer: string;
        focusArea?: string | null;
        createdAt?: string;
      }>;
    },
  ) {
    if (!this.networkService.isOnline()) {
      return of(
        this.offlineLifeService.buildOfflineAssistantReply(
          question,
          options?.history || [],
          options?.originModule || undefined,
        ),
      );
    }

    return this.http
      .post<AssistantReply>(`${environment.apiBaseUrl}/assistant/ask`, {
        question,
        originModule: options?.originModule || undefined,
        history: options?.history?.slice(0, 6).map((item) => ({
          question: item.question,
          answer: item.answer,
          focusArea: item.focusArea || undefined,
          createdAt: item.createdAt || undefined,
        })),
      })
      .pipe(
        this.withOfflineFallback(() =>
          this.offlineLifeService.buildOfflineAssistantReply(
            question,
            options?.history || [],
            options?.originModule || undefined,
          ),
        ),
      );
  }

  applyAssistantAction(
    action: AssistantAction,
  ): Observable<{
    success: boolean;
    kind: string;
    entity?: unknown;
    route?: string | null;
  }> {
    if (action.kind === "open_module") {
      return of({
        success: true,
        kind: action.kind,
        route: action.route,
      });
    }

    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.applyOfflineAssistantAction(action));
    }

    return this.http.post<{ success: boolean; kind: string; entity?: unknown; route?: string | null }>(
      `${environment.apiBaseUrl}/assistant/actions`,
      {
        kind: action.kind,
        title: action.title,
        payload: action.payload || undefined,
        route: action.route || undefined,
      },
    );
  }

  listReminders() {
    if (!this.networkService.isOnline() || this.offlineLifeService.hasPendingSync()) {
      void this.flushPendingSync();
      return of(this.offlineLifeService.readReminders());
    }

    return this.http.get<Reminder[]>(`${environment.apiBaseUrl}/reminders`).pipe(
      tap((reminders) => this.offlineLifeService.cacheReminders(reminders)),
      this.withOfflineFallback(() => this.offlineLifeService.readReminders()),
    );
  }

  createReminder(payload: Record<string, unknown>) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueReminderCreate(payload));
    }

    return this.http.post<Reminder>(`${environment.apiBaseUrl}/reminders`, payload).pipe(
      tap((reminder) => this.offlineLifeService.reconcileReminder(reminder)),
      this.withMutationOfflineFallback(() =>
        this.offlineLifeService.queueReminderCreate(payload),
      ),
    );
  }

  updateReminder(id: string, payload: Record<string, unknown>) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueReminderUpdate(id, payload) as Reminder);
    }

    return this.http.patch<Reminder>(`${environment.apiBaseUrl}/reminders/${id}`, payload).pipe(
      tap((reminder) =>
        this.offlineLifeService.reconcileReminder(
          reminder,
          id.startsWith("offline-") ? id : undefined,
        ),
      ),
      this.withMutationOfflineFallback(
        () => this.offlineLifeService.queueReminderUpdate(id, payload) as Reminder,
      ),
    );
  }

  deleteReminder(id: string) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueReminderDelete(id));
    }

    return this.http.delete<{ success: boolean }>(`${environment.apiBaseUrl}/reminders/${id}`).pipe(
      this.withMutationOfflineFallback(() => this.offlineLifeService.queueReminderDelete(id)),
    );
  }

  listReceiptHistory() {
    return this.http.get<ReceiptScanHistoryEntry[]>(
      `${environment.apiBaseUrl}/imports/receipts`,
    );
  }

  listCsvImportHistory() {
    return this.http.get<ImportJobHistoryEntry[]>(
      `${environment.apiBaseUrl}/imports/transactions`,
    );
  }

  listAssistantHistory(limit = 20) {
    return this.http.get<AssistantHistoryTurn[]>(
      `${environment.apiBaseUrl}/assistant/history`,
      { params: { limit: String(limit) } },
    );
  }

  saveAssistantTurn(turn: { question: string; answer: string; focusArea?: string | null; source?: string | null }) {
    return this.http.post<AssistantHistoryTurn>(
      `${environment.apiBaseUrl}/assistant/history`,
      { question: turn.question, answer: turn.answer, focusArea: turn.focusArea ?? undefined, source: turn.source ?? undefined },
    );
  }

  listAdminSupportRequests(params?: { status?: string; type?: string; page?: number }) {
    return this.http.get<SupportRequest[]>(
      `${environment.apiBaseUrl}/support-requests/admin`,
      {
        params: {
          ...(params?.status ? { status: params.status } : {}),
          ...(params?.type ? { type: params.type } : {}),
          page: String(params?.page ?? 1),
        },
      },
    );
  }

  listEnvelopes() {
    return this.http.get<Envelope[]>(`${environment.apiBaseUrl}/envelopes`);
  }

  createEnvelope(payload: { name: string; color: string; icon?: string; monthlyAmount: number }) {
    return this.http.post<Envelope>(`${environment.apiBaseUrl}/envelopes`, payload);
  }

  updateEnvelope(
    id: string,
    payload: { name?: string; monthlyAmount?: number; isActive?: boolean },
  ) {
    return this.http.patch<Envelope>(`${environment.apiBaseUrl}/envelopes/${id}`, payload);
  }

  deleteEnvelope(id: string) {
    return this.http.delete<{ success: boolean }>(`${environment.apiBaseUrl}/envelopes/${id}`);
  }

  getCurrentCreditCycle() {
    return this.http.get<CreditCycle>(`${environment.apiBaseUrl}/credit-cycle/current`);
  }

  updateCreditCycleSettings(payload: { dueDay?: number | null; countAllPayments?: boolean }) {
    return this.http.patch<CreditCycle>(`${environment.apiBaseUrl}/credit-cycle/settings`, payload);
  }

  setCreditCycleCeiling(payload: { ceiling: number }) {
    return this.http.put<CreditCycle>(`${environment.apiBaseUrl}/credit-cycle/ceiling`, payload);
  }

  /** Cartoes ativos; includeArchived traz o historico. Escritas sao online-only (sem fila offline). */
  listCreditCards(includeArchived = false) {
    const query = includeArchived ? "?includeArchived=true" : "";
    return this.http.get<CreditCard[]>(`${environment.apiBaseUrl}/credit-cards${query}`);
  }

  /** Define o teto do ciclo aberto de um cartao. Devolve recibo; quem chama recarrega o ciclo. */
  setCreditCardCeiling(id: string, ceiling: number) {
    return this.http.put<{ cardId: string; refreshPending: boolean }>(
      `${environment.apiBaseUrl}/credit-cards/${encodeURIComponent(id)}/ceiling`,
      { ceiling },
    );
  }

  /** Ciclo aberto de um cartao (mesma forma de getCurrentCreditCycle). */
  getCreditCardCycle(id: string) {
    return this.http.get<CreditCycle>(`${environment.apiBaseUrl}/credit-cards/${encodeURIComponent(id)}/cycle`);
  }

  createCreditCard(payload: Required<Pick<CreditCardInput, "name" | "closingDay">> & { dueDay: number | null }) {
    return this.http.post<CreditCardReceipt>(`${environment.apiBaseUrl}/credit-cards`, payload);
  }

  updateCreditCard(id: string, payload: CreditCardInput) {
    return this.http.patch<CreditCardReceipt>(`${environment.apiBaseUrl}/credit-cards/${encodeURIComponent(id)}`, payload);
  }

  archiveCreditCard(id: string) {
    return this.http.delete<CreditCardReceipt>(`${environment.apiBaseUrl}/credit-cards/${encodeURIComponent(id)}`);
  }

  makeDefaultCreditCard(id: string) {
    return this.http.post<CreditCardReceipt>(`${environment.apiBaseUrl}/credit-cards/${encodeURIComponent(id)}/make-default`, {});
  }

  getFeedbackSummary() {
    return this.http.get<FeedbackSummary>(
      `${environment.apiBaseUrl}/support-requests/admin/feedback-summary`,
    );
  }

  updateSupportRequestStatus(id: string, status: string) {
    return this.http.patch<{ id: string; status: string; updatedAt: string }>(
      `${environment.apiBaseUrl}/support-requests/admin/${id}/status`,
      { status },
    );
  }

  previewImport(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    return this.http.post<ImportPreview>(
      `${environment.apiBaseUrl}/imports/transactions/preview`,
      formData,
    );
  }

  commitImport(importJobId: string) {
    return this.http.post(
      `${environment.apiBaseUrl}/imports/transactions/commit`,
      {
        importJobId,
        skipDuplicates: true,
      },
    );
  }

  previewReceiptImport(file: File, tagGroupId: string, compareWithPrevious: boolean) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("tagGroupId", tagGroupId);
    formData.append("compareWithPrevious", String(compareWithPrevious));
    return this.http.post<ReceiptImportPreview>(
      `${environment.apiBaseUrl}/imports/receipts/preview`,
      formData,
    );
  }

  getTagGroups() {
    return this.http.get<TagGroup[]>(`${environment.apiBaseUrl}/tag-groups`);
  }

  createTagGroup(payload: { name: string; color?: string }) {
    return this.http.post<TagGroup>(`${environment.apiBaseUrl}/tag-groups`, payload);
  }

  updateTagGroup(id: string, payload: { name?: string; color?: string }) {
    return this.http.patch<TagGroup>(`${environment.apiBaseUrl}/tag-groups/${id}`, payload);
  }

  deleteTagGroup(id: string) {
    return this.http.delete<{ success: boolean }>(`${environment.apiBaseUrl}/tag-groups/${id}`);
  }

  commitReceiptImport(payload: {
    receiptScanId: string;
    merchantName?: string;
    description?: string;
    purchaseDate?: string | null;
    totalAmount?: number;
    categoryId?: string | null;
    items?: Array<{
      description: string;
      quantity: number;
      unitPrice: number | null;
      totalPrice: number;
    }>;
    acknowledgeDuplicate?: boolean;
  }) {
    return this.http.post<ReceiptImportCommitResponse>(
      `${environment.apiBaseUrl}/imports/receipts/commit`,
      payload,
    );
  }

  listNotifications() {
    if (!this.networkService.isOnline() || this.offlineLifeService.hasPendingSync()) {
      void this.flushPendingSync();
      return of(this.offlineLifeService.readNotifications());
    }

    return this.http
      .get<Notification[]>(`${environment.apiBaseUrl}/notifications`)
      .pipe(
        tap((notifications) =>
          this.offlineLifeService.cacheNotifications(notifications),
        ),
        this.withOfflineFallback(() => this.offlineLifeService.readNotifications()),
      );
  }

  markNotificationAsRead(id: string) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueNotificationRead(id));
    }

    return this.http
      .patch<Notification>(`${environment.apiBaseUrl}/notifications/${id}/read`, {})
      .pipe(
        map(() => ({ success: true })),
        this.withMutationOfflineFallback(() =>
          this.offlineLifeService.queueNotificationRead(id),
        ),
      );
  }

  updateUser(
    payload: Partial<User> & {
      avatarUrl?: string | null;
      privacyNoticeAccepted?: boolean;
      aiAssistantEnabled?: boolean;
    },
  ) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueUserUpdate(payload));
    }

    return this.http.patch<User>(`${environment.apiBaseUrl}/users/me`, payload).pipe(
      tap((user) => this.offlineLifeService.reconcileUser(user)),
      this.withMutationOfflineFallback(() =>
        this.offlineLifeService.queueUserUpdate(payload),
      ),
    );
  }

  exportMyData() {
    return this.http.get<PrivacyExportPayload>(
      `${environment.apiBaseUrl}/users/me/privacy-export`,
    );
  }

  listRecurringTransactions() {
    return this.http.get<RecurringTransaction[]>(
      `${environment.apiBaseUrl}/recurring-transactions`,
    );
  }

  createRecurringTransaction(payload: {
    type: "INCOME" | "EXPENSE";
    description: string;
    amount: number;
    categoryId?: string;
    paymentMethod?: PaymentMethod;
    frequency: RecurrenceFrequency;
    firstDueDate: string;
    endDate?: string;
    cardId?: string;
  }) {
    return this.http.post<RecurringTransaction>(
      `${environment.apiBaseUrl}/recurring-transactions`,
      payload,
    );
  }

  updateRecurringTransaction(id: string, payload: { isActive?: boolean }) {
    return this.http.patch<RecurringTransaction>(
      `${environment.apiBaseUrl}/recurring-transactions/${id}`,
      payload,
    );
  }

  deleteRecurringTransaction(id: string) {
    return this.http.delete<{ success: boolean }>(
      `${environment.apiBaseUrl}/recurring-transactions/${id}`,
    );
  }

  listInstallmentPurchases() {
    return this.http.get<InstallmentPurchase[]>(`${environment.apiBaseUrl}/installments`);
  }

  createInstallmentPurchase(payload: {
    description: string;
    totalAmount: number;
    installmentsTotal: number;
    categoryId?: string;
    paymentMethod?: PaymentMethod;
    firstDueDate?: string;
    cardId?: string;
  }) {
    return this.http.post<InstallmentPurchase>(`${environment.apiBaseUrl}/installments`, payload);
  }

  deleteInstallmentPurchase(id: string) {
    return this.http.delete<{ success: boolean }>(`${environment.apiBaseUrl}/installments/${id}`);
  }

  updateFinanceCategory(id: string, payload: { monthlyBudget: number | null }) {
    return this.http.patch<FinanceCategory>(
      `${environment.apiBaseUrl}/finance-categories/${id}`,
      payload,
    );
  }

  createFinanceCategory(payload: { name: string; color: string; type: 'INCOME' | 'EXPENSE'; icon?: string }) {
    return this.http.post<FinanceCategory>(`${environment.apiBaseUrl}/finance-categories`, payload);
  }

  deleteFinanceCategory(id: string) {
    return this.http.delete<{ success: boolean }>(`${environment.apiBaseUrl}/finance-categories/${id}`);
  }

  deleteMyAccount(password: string) {
    return this.http.delete<{ message: string; deletedAt: string }>(
      `${environment.apiBaseUrl}/users/me`,
      { body: { password } },
    );
  }

  listSupportRequests() {
    if (!this.networkService.isOnline() || this.offlineLifeService.hasPendingSync()) {
      void this.flushPendingSync();
      return of(this.offlineLifeService.readSupportRequests());
    }

    return this.http.get<SupportRequest[]>(
      `${environment.apiBaseUrl}/support-requests`,
    ).pipe(
      tap((requests) => this.offlineLifeService.cacheSupportRequests(requests)),
      this.withOfflineFallback(() => this.offlineLifeService.readSupportRequests()),
    );
  }

  createSupportRequest(payload: {
    type: SupportRequest["type"];
    subject: string;
    message: string;
    severity?: SupportRequest["severity"];
    screenPath?: string;
    appVersion?: string;
    deviceInfo?: string;
    rating?: number;
    area?: string;
    canContact?: boolean;
  }) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.queueSupportRequestCreate(payload));
    }

    return this.http.post<SupportRequest>(
      `${environment.apiBaseUrl}/support-requests`,
      payload,
    ).pipe(
      tap((request) => this.offlineLifeService.reconcileSupportRequest(request)),
      this.withMutationOfflineFallback(() =>
        this.offlineLifeService.queueSupportRequestCreate(payload),
      ),
    );
  }

  private withOfflineFallback<T>(fallbackFactory: () => T) {
    return (source: Observable<T>) =>
      new Observable<T>((observer) => {
        const subscription = source.subscribe({
          next: (value) => observer.next(value),
          complete: () => observer.complete(),
          error: (error) => {
            if (this.shouldUseOfflineFallback(error)) {
              observer.next(fallbackFactory());
              observer.complete();
              return;
            }

            observer.error(error);
          },
        });

        return () => subscription.unsubscribe();
      });
  }

  private withMutationOfflineFallback<T>(fallbackFactory: () => T) {
    return this.withOfflineFallback(fallbackFactory);
  }

  private shouldUseOfflineFallback(error: unknown) {
    if (!this.networkService.isOnline()) {
      return true;
    }

    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: number }).status)
        : undefined;

    return status === 0 || status === undefined;
  }

  private async flushPendingSync() {
    if (
      !this.networkService.isOnline() ||
      this.syncInFlight() ||
      !this.offlineLifeService.hasPendingSync()
    ) {
      return;
    }

    const readyItems = this.offlineLifeService.getReadyQueueSnapshot();

    if (!readyItems.length) {
      return;
    }

    this.syncInFlight.set(true);

    try {
      for (const item of readyItems) {
        this.offlineLifeService.markQueueItemSyncing(item.id);

        try {
          await this.flushQueueItem(item);
          this.offlineLifeService.removeQueueItem(item.id);
        } catch (error) {
          if (this.shouldUseOfflineFallback(error)) {
            this.offlineLifeService.markQueueItemPending(item.id);
            break;
          }

          this.offlineLifeService.markQueueItemFailed(
            item.id,
            this.getSyncErrorMessage(error),
          );
          break;
        }
      }
    } finally {
      this.syncInFlight.set(false);
    }
  }

  private async flushQueueItem(item: {
    entity:
      | "task"
      | "transaction"
      | "goal"
      | "user"
      | "reminder"
      | "notification"
      | "supportRequest";
    action: "create" | "update" | "delete" | "contribute" | "read";
    recordId?: string;
    payload?: Record<string, unknown>;
  }) {
    if (item.entity === "task") {
      await this.flushTaskItem(item);
      return;
    }

    if (item.entity === "transaction") {
      await this.flushTransactionItem(item);
      return;
    }

    if (item.entity === "goal") {
      await this.flushGoalItem(item);
      return;
    }

    if (item.entity === "reminder") {
      await this.flushReminderItem(item);
      return;
    }

    if (item.entity === "notification") {
      await this.flushNotificationItem(item);
      return;
    }

    if (item.entity === "supportRequest") {
      await this.flushSupportRequestItem(item);
      return;
    }

    if (item.entity === "user" && item.action === "update") {
      const user = await firstValueFrom(
        this.http.patch<User>(`${environment.apiBaseUrl}/users/me`, item.payload ?? {}),
      );
      this.offlineLifeService.reconcileUser(user);
    }
  }

  private async flushTaskItem(item: {
    action: "create" | "update" | "delete" | "contribute" | "read";
    recordId?: string;
    payload?: Record<string, unknown>;
  }) {
    if (item.action === "create") {
      const task = await firstValueFrom(
        this.http.post<Task>(`${environment.apiBaseUrl}/tasks`, item.payload ?? {}),
      );
      this.offlineLifeService.reconcileTask(task, item.recordId);
      return;
    }

    if (item.action === "update" && item.recordId) {
      const task = await firstValueFrom(
        this.http.patch<Task>(
          `${environment.apiBaseUrl}/tasks/${item.recordId}`,
          item.payload ?? {},
        ),
      );
      this.offlineLifeService.reconcileTask(task);
      return;
    }

    if (item.action === "delete" && item.recordId) {
      await firstValueFrom(
        this.http.delete(`${environment.apiBaseUrl}/tasks/${item.recordId}`),
      );
    }
  }

  private async flushTransactionItem(item: {
    action: "create" | "update" | "delete" | "contribute" | "read";
    recordId?: string;
    payload?: Record<string, unknown>;
  }) {
    if (item.action === "create") {
      const transaction = await firstValueFrom(
        this.http.post<Transaction>(
          `${environment.apiBaseUrl}/transactions`,
          item.payload ?? {},
        ),
      );
      this.offlineLifeService.reconcileTransaction(transaction, item.recordId);
      return;
    }

    if (item.action === "update" && item.recordId) {
      const transaction = await firstValueFrom(
        this.http.patch<Transaction>(
          `${environment.apiBaseUrl}/transactions/${item.recordId}`,
          item.payload ?? {},
        ),
      );
      this.offlineLifeService.reconcileTransaction(transaction);
      return;
    }

    if (item.action === "delete" && item.recordId) {
      await firstValueFrom(
        this.http.delete(`${environment.apiBaseUrl}/transactions/${item.recordId}`),
      );
    }
  }

  private async flushGoalItem(item: {
    action: "create" | "update" | "delete" | "contribute" | "read";
    recordId?: string;
    payload?: Record<string, unknown>;
  }) {
    if (item.action === "create") {
      const goal = await firstValueFrom(
        this.http.post<Goal>(`${environment.apiBaseUrl}/goals`, item.payload ?? {}),
      );
      this.offlineLifeService.reconcileGoal(goal, item.recordId);
      return;
    }

    if (item.action === "update" && item.recordId) {
      const goal = await firstValueFrom(
        this.http.patch<Goal>(
          `${environment.apiBaseUrl}/goals/${item.recordId}`,
          item.payload ?? {},
        ),
      );
      this.offlineLifeService.reconcileGoal(goal);
      return;
    }

    if (item.action === "contribute" && item.recordId) {
      const goal = await firstValueFrom(
        this.http.patch<Goal>(
          `${environment.apiBaseUrl}/goals/${item.recordId}/contribute`,
          item.payload ?? {},
        ),
      );
      this.offlineLifeService.reconcileGoal(goal);
      return;
    }

    if (item.action === "delete" && item.recordId) {
      await firstValueFrom(
        this.http.delete(`${environment.apiBaseUrl}/goals/${item.recordId}`),
      );
    }
  }

  private async flushReminderItem(item: {
    action: "create" | "update" | "delete" | "contribute" | "read";
    recordId?: string;
    payload?: Record<string, unknown>;
  }) {
    if (item.action === "create") {
      const reminder = await firstValueFrom(
        this.http.post<Reminder>(`${environment.apiBaseUrl}/reminders`, item.payload ?? {}),
      );
      this.offlineLifeService.reconcileReminder(reminder, item.recordId);
      return;
    }

    if (item.action === "update" && item.recordId) {
      const reminder = await firstValueFrom(
        this.http.patch<Reminder>(
          `${environment.apiBaseUrl}/reminders/${item.recordId}`,
          item.payload ?? {},
        ),
      );
      this.offlineLifeService.reconcileReminder(reminder);
      return;
    }

    if (item.action === "delete" && item.recordId) {
      await firstValueFrom(
        this.http.delete(`${environment.apiBaseUrl}/reminders/${item.recordId}`),
      );
    }
  }

  private async flushNotificationItem(item: {
    action: "create" | "update" | "delete" | "contribute" | "read";
    recordId?: string;
    payload?: Record<string, unknown>;
  }) {
    if (item.action === "read" && item.recordId) {
      await firstValueFrom(
        this.http.patch(`${environment.apiBaseUrl}/notifications/${item.recordId}/read`, {}),
      );
    }
  }

  private async flushSupportRequestItem(item: {
    action: "create" | "update" | "delete" | "contribute" | "read";
    recordId?: string;
    payload?: Record<string, unknown>;
  }) {
    if (item.action === "create") {
      const request = await firstValueFrom(
        this.http.post<SupportRequest>(
          `${environment.apiBaseUrl}/support-requests`,
          item.payload ?? {},
        ),
      );
      this.offlineLifeService.reconcileSupportRequest(request, item.recordId);
    }
  }

  private getSyncErrorMessage(error: unknown) {
    if (typeof error === "object" && error !== null) {
      const candidate = error as {
        error?: { message?: string };
        message?: string;
        status?: number;
      };

      if (candidate.error?.message) {
        return candidate.error.message;
      }

      if (candidate.message) {
        return candidate.message;
      }

      if (candidate.status) {
        return `Falha ao sincronizar (HTTP ${candidate.status}).`;
      }
    }

    return "Falha ao sincronizar este item com o servidor.";
  }
}
