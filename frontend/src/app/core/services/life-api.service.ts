import { inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { environment } from "../../../environments/environment";
import {
  AssistantReply,
  DashboardSummary,
  Goal,
  ImportPreview,
  Notification,
  PrivacyExportPayload,
  Task,
  Transaction,
  User,
} from "../models/domain.models";

@Injectable({ providedIn: "root" })
export class LifeApiService {
  private readonly http = inject(HttpClient);

  getDashboardSummary() {
    return this.http.get<DashboardSummary>(
      `${environment.apiBaseUrl}/dashboard/summary`,
    );
  }

  listTasks() {
    return this.http.get<Task[]>(`${environment.apiBaseUrl}/tasks`);
  }

  createTask(payload: Record<string, unknown>) {
    return this.http.post<Task>(`${environment.apiBaseUrl}/tasks`, payload);
  }

  updateTask(id: string, payload: Record<string, unknown>) {
    return this.http.patch<Task>(
      `${environment.apiBaseUrl}/tasks/${id}`,
      payload,
    );
  }

  deleteTask(id: string) {
    return this.http.delete(`${environment.apiBaseUrl}/tasks/${id}`);
  }

  listTransactions() {
    return this.http.get<Transaction[]>(
      `${environment.apiBaseUrl}/transactions`,
    );
  }

  createTransaction(payload: Record<string, unknown>) {
    return this.http.post<Transaction>(
      `${environment.apiBaseUrl}/transactions`,
      payload,
    );
  }

  deleteTransaction(id: string) {
    return this.http.delete(`${environment.apiBaseUrl}/transactions/${id}`);
  }

  listGoals() {
    return this.http.get<Goal[]>(`${environment.apiBaseUrl}/goals`);
  }

  createGoal(payload: Record<string, unknown>) {
    return this.http.post<Goal>(`${environment.apiBaseUrl}/goals`, payload);
  }

  contributeGoal(id: string, payload: Record<string, unknown>) {
    return this.http.patch<Goal>(
      `${environment.apiBaseUrl}/goals/${id}/contribute`,
      payload,
    );
  }

  deleteGoal(id: string) {
    return this.http.delete(`${environment.apiBaseUrl}/goals/${id}`);
  }

  askAssistant(question: string) {
    return this.http.post<AssistantReply>(
      `${environment.apiBaseUrl}/assistant/ask`,
      {
        question,
      },
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

  listNotifications() {
    return this.http.get<Notification[]>(
      `${environment.apiBaseUrl}/notifications`,
    );
  }

  markNotificationAsRead(id: string) {
    return this.http.patch(
      `${environment.apiBaseUrl}/notifications/${id}/read`,
      {},
    );
  }

  updateUser(
    payload: Partial<User> & {
      privacyNoticeAccepted?: boolean;
      aiAssistantEnabled?: boolean;
    },
  ) {
    return this.http.patch<User>(`${environment.apiBaseUrl}/users/me`, payload);
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
}
