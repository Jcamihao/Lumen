import { CommonModule, DatePipe } from "@angular/common";
import { Component, computed, inject } from "@angular/core";
import { EmptyStateComponent } from "../../../shared/components/empty-state/empty-state.component";
import { PanelComponent } from "../../../shared/components/panel/panel.component";
import { UiBadgeComponent } from "../../../shared/components/ui-badge/ui-badge.component";
import { UiButtonComponent } from "../../../shared/components/ui-button/ui-button.component";
import { NotificationCenterService } from "../../../core/services/notification-center.service";

@Component({
  selector: "app-notifications-page",
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    PanelComponent,
    UiBadgeComponent,
    UiButtonComponent,
    EmptyStateComponent,
  ],
  templateUrl: "./notifications-page.component.html",
  styleUrls: ["./notifications-page.component.scss"],
})
export class NotificationsPageComponent {
  protected readonly notificationCenter = inject(NotificationCenterService);
  protected readonly nativeAlertsLabel = computed(() => {
    if (!this.notificationCenter.localReminders.isNative) {
      return "Web / PWA";
    }

    return this.notificationCenter.localReminders.notificationsEnabled()
      ? "Alertas locais ativos"
      : "Permissão pendente";
  });

  constructor() {
    void this.notificationCenter.load();
  }

  protected markAsRead(id: string) {
    this.notificationCenter.markAsRead(id);
  }

  protected enableLocalNotifications() {
    void this.notificationCenter.localReminders.requestPermission().then(() => {
      void this.notificationCenter.load();
    });
  }
}
