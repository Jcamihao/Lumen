import { computed, Injectable, signal, inject } from "@angular/core";
import { Capacitor } from "@capacitor/core";
import {
  LocalNotifications,
  PermissionStatus,
} from "@capacitor/local-notifications";
import { Reminder } from "../models/domain.models";
import { NativeStorageService } from "./native-storage.service";

type LocalPermissionState = "unsupported" | "unknown" | "granted" | "denied";

@Injectable({ providedIn: "root" })
export class LocalReminderNotificationsService {
  private readonly storage = inject(NativeStorageService);
  private readonly scheduledIdsKey = "lumen:local-reminder-ids";
  private readonly native = Capacitor.isNativePlatform();
  private readonly permissionSignal = signal<LocalPermissionState>(
    this.native ? "unknown" : "unsupported",
  );
  private readonly scheduledCountSignal = signal(0);
  private autoPermissionAttempted = false;

  readonly isNative = this.native;
  readonly permissionState = this.permissionSignal.asReadonly();
  readonly scheduledCount = this.scheduledCountSignal.asReadonly();
  readonly notificationsEnabled = computed(
    () => this.permissionSignal() === "granted",
  );

  async syncReminders(reminders: Reminder[]) {
    if (!this.native) {
      return;
    }

    const upcoming = reminders
      .filter((reminder) => new Date(reminder.remindAt).getTime() > Date.now())
      .sort(
        (left, right) =>
          new Date(left.remindAt).getTime() - new Date(right.remindAt).getTime(),
      )
      .slice(0, 64);

    if (!upcoming.length) {
      await this.clearScheduled();
      return;
    }

    const granted = await this.ensurePermission();

    if (!granted) {
      this.scheduledCountSignal.set(0);
      return;
    }

    const previousIds = this.readScheduledIds();

    if (previousIds.length) {
      await LocalNotifications.cancel({
        notifications: previousIds.map((id) => ({ id })),
      });
    }

    const notifications = upcoming.map((reminder) => ({
      id: this.hashReminderId(reminder.id),
      title: "Lembrete do LUMEN",
      body: reminder.title,
      schedule: {
        at: new Date(reminder.remindAt),
        allowWhileIdle: true,
      },
      extra: {
        reminderId: reminder.id,
      },
    }));

    await LocalNotifications.schedule({ notifications });
    const nextIds = notifications.map((item) => item.id);
    this.writeScheduledIds(nextIds);
    this.scheduledCountSignal.set(nextIds.length);
  }

  async requestPermission() {
    if (!this.native) {
      this.permissionSignal.set("unsupported");
      return false;
    }

    try {
      const permission = await LocalNotifications.requestPermissions();
      return this.resolvePermission(permission);
    } catch {
      this.permissionSignal.set("denied");
      return false;
    }
  }

  private async ensurePermission() {
    if (!this.native) {
      return false;
    }

    try {
      const permission = await LocalNotifications.checkPermissions();

      if (permission.display === "granted") {
        this.permissionSignal.set("granted");
        return true;
      }

      this.permissionSignal.set(
        permission.display === "denied" ? "denied" : "unknown",
      );

      if (!this.autoPermissionAttempted) {
        this.autoPermissionAttempted = true;
        return this.requestPermission();
      }

      return false;
    } catch {
      this.permissionSignal.set("denied");
      return false;
    }
  }

  private resolvePermission(permission: PermissionStatus) {
    const granted = permission.display === "granted";
    this.permissionSignal.set(granted ? "granted" : "denied");
    return granted;
  }

  private async clearScheduled() {
    const previousIds = this.readScheduledIds();

    if (previousIds.length) {
      await LocalNotifications.cancel({
        notifications: previousIds.map((id) => ({ id })),
      });
    }

    this.writeScheduledIds([]);
    this.scheduledCountSignal.set(0);
  }

  private readScheduledIds() {
    try {
      const raw = this.storage.getItem(this.scheduledIdsKey);
      const parsed = raw ? (JSON.parse(raw) as number[]) : [];
      return Array.isArray(parsed)
        ? parsed.filter((value): value is number => Number.isInteger(value))
        : [];
    } catch {
      return [];
    }
  }

  private writeScheduledIds(ids: number[]) {
    this.storage.setItem(this.scheduledIdsKey, JSON.stringify(ids));
  }

  private hashReminderId(reminderId: string) {
    let hash = 0;

    for (let index = 0; index < reminderId.length; index += 1) {
      hash = (hash * 31 + reminderId.charCodeAt(index)) | 0;
    }

    return Math.abs(hash) || 1;
  }
}
