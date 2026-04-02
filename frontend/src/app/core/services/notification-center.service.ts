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
  private loadPromise: Promise<void> | null = null;
  private lastLoadedAt = 0;
  private readonly freshnessWindowMs = 30_000;

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
    let previousOffline = this.api.offlineMode();

    effect(() => {
      const userId = this.authService.currentUser()?.id ?? null;

      this.notificationsSignal.set([]);
      this.remindersSignal.set([]);
      this.initializedSignal.set(false);
      this.loadPromise = null;
      this.lastLoadedAt = 0;

      if (userId) {
        queueMicrotask(() => {
          void this.load();
        });
      }
    });

    effect(() => {
      const initialized = this.initialized();
      const offline = this.api.offlineMode();
      const shouldRefresh = initialized && previousOffline && !offline;
      previousOffline = offline;

      if (shouldRefresh) {
        queueMicrotask(() => {
          void this.load(true);
        });
      }
    });

    effect(() => {
      void this.localReminders.syncReminders(this.reminders());
    });
  }

  async load(force = false) {
    if (!this.authService.currentUser()?.id) {
      return;
    }

    if (
      !force &&
      this.initialized() &&
      this.lastLoadedAt > 0 &&
      Date.now() - this.lastLoadedAt < this.freshnessWindowMs
    ) {
      return;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadingSignal.set(true);

    this.loadPromise = (async () => {
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
        this.lastLoadedAt = Date.now();
      } finally {
        this.loadingSignal.set(false);
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
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
