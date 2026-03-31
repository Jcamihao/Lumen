import { HttpClient } from "@angular/common/http";
import { computed, effect, inject, Injectable, signal } from "@angular/core";
import { firstValueFrom, map, Observable, of, tap } from "rxjs";
import { environment } from "../../../environments/environment";
import {
  AssistantReply,
  DashboardSummary,
  Goal,
  ImportPreview,
  Notification,
  PrivacyExportPayload,
  Reminder,
  ReceiptImportCommitResponse,
  ReceiptImportPreview,
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
  readonly syncing = this.syncInFlight.asReadonly();

  constructor() {
    effect(() => {
      if (this.networkService.isOnline()) {
        queueMicrotask(() => {
          void this.flushPendingSync();
        });
      }
    });
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

  listTransactions() {
    if (!this.networkService.isOnline() || this.offlineLifeService.hasPendingSync()) {
      void this.flushPendingSync();
      return of(this.offlineLifeService.readTransactions());
    }

    return this.http
      .get<Transaction[]>(`${environment.apiBaseUrl}/transactions`)
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

  askAssistant(question: string) {
    if (!this.networkService.isOnline()) {
      return of(this.offlineLifeService.buildOfflineAssistantReply(question));
    }

    return this.http
      .post<AssistantReply>(`${environment.apiBaseUrl}/assistant/ask`, {
        question,
      })
      .pipe(
        this.withOfflineFallback(() =>
          this.offlineLifeService.buildOfflineAssistantReply(question),
        ),
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

  previewReceiptImport(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    return this.http.post<ReceiptImportPreview>(
      `${environment.apiBaseUrl}/imports/receipts/preview`,
      formData,
    );
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

  deleteMyAccount() {
    return this.http.delete<{ message: string; deletedAt: string }>(
      `${environment.apiBaseUrl}/users/me`,
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

    this.syncInFlight.set(true);

    try {
      for (const item of this.offlineLifeService.getQueueSnapshot()) {
        try {
          await this.flushQueueItem(item);
          this.offlineLifeService.removeQueueItem(item.id);
        } catch (error) {
          if (this.shouldUseOfflineFallback(error)) {
            break;
          }

          throw error;
        }
      }
    } finally {
      this.syncInFlight.set(false);
    }
  }

  private async flushQueueItem(item: {
    entity: "task" | "transaction" | "goal" | "user" | "reminder" | "notification";
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
}
