import { computed, effect, inject, Injectable, signal } from "@angular/core";
import { firstValueFrom, forkJoin } from "rxjs";
import {
  Notification,
  NotificationCenterEntry,
  Reminder,
} from "../models/domain.models";
import { AuthService } from "./auth.service";
import { LifeApiService } from "./life-api.service";
import { LocalReminderNotificationsService } from "./local-reminder-notifications.service";

@Injectable({ providedIn: "root" })
export class NotificationCenterService {
  private readonly authService = inject(AuthService);
  private readonly api = inject(LifeApiService);
  readonly localReminders = inject(LocalReminderNotificationsService);

  private readonly notificationsSignal = signal<Notification[]>([]);
  private readonly remindersSignal = signal<Reminder[]>([]);
  private readonly loadingSignal = signal(false);
  private readonly initializedSignal = signal(false);

  readonly notifications = this.notificationsSignal.asReadonly();
  readonly reminders = this.remindersSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly initialized = this.initializedSignal.asReadonly();
  readonly unreadCount = computed(
    () => this.notifications().filter((notification) => !notification.isRead).length,
  );
  readonly recentEntries = computed<NotificationCenterEntry[]>(() => {
    const notificationEntries = this.notifications().map((notification) => ({
      id: notification.id,
      kind: "notification" as const,
      title: notification.title,
      description: notification.message,
      date: notification.createdAt,
      isRead: notification.isRead,
    }));

    const reminderEntries = this.reminders().map((reminder) => ({
      id: reminder.id,
      kind: "reminder" as const,
      title: reminder.title,
      description: "Lembrete programado",
      date: reminder.remindAt,
      isRead: false,
    }));

    return [...notificationEntries, ...reminderEntries]
      .sort(
        (left, right) =>
          new Date(right.date).getTime() - new Date(left.date).getTime(),
      )
      .slice(0, 8);
  });

  constructor() {
    effect(() => {
      const userId = this.authService.currentUser()?.id ?? null;

      this.notificationsSignal.set([]);
      this.remindersSignal.set([]);
      this.initializedSignal.set(false);

      if (userId) {
        queueMicrotask(() => {
          void this.load();
        });
      }
    });

    effect(() => {
      if (this.initialized() && !this.api.offlineMode()) {
        queueMicrotask(() => {
          void this.load();
        });
      }
    });

    effect(() => {
      void this.localReminders.syncReminders(this.reminders());
    });
  }

  async load() {
    if (!this.authService.currentUser()?.id || this.loading()) {
      return;
    }

    this.loadingSignal.set(true);

    try {
      const result = await firstValueFrom(
        forkJoin({
          notifications: this.api.listNotifications(),
          reminders: this.api.listReminders(),
        }),
      );

      this.notificationsSignal.set(result.notifications);
      this.remindersSignal.set(result.reminders);
      this.initializedSignal.set(true);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  markAsRead(notificationId: string) {
    const current = this.notifications();
    const target = current.find((notification) => notification.id === notificationId);

    if (!target || target.isRead) {
      return;
    }

    this.notificationsSignal.set(
      current.map((notification) =>
        notification.id === notificationId
          ? { ...notification, isRead: true }
          : notification,
      ),
    );

    this.api.markNotificationAsRead(notificationId).subscribe({
      error: () => {
        this.notificationsSignal.set(current);
      },
    });
  }
}
