import { CommonModule } from "@angular/common";
import { Component, computed, inject } from "@angular/core";
import { NotificationCenterService } from "../../../core/services/notification-center.service";

@Component({
  selector: "app-notifications-page",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./notifications-page.component.html",
  styleUrls: ["./notifications-page.component.scss"],
})
export class NotificationsPageComponent {
  protected readonly notificationCenter = inject(NotificationCenterService);
  protected readonly preferenceItems = [
    {
      id: "tasks",
      label: "Lembretes de tarefas",
      description: "Receba alertas para tarefas com prazo próximo.",
    },
    {
      id: "finance",
      label: "Alertas financeiros",
      description: "Notificações sobre vencimentos e despesas incomuns.",
    },
    {
      id: "goals",
      label: "Progresso de metas",
      description: "Atualizações sobre metas e marcos alcançados.",
    },
    {
      id: "assistant",
      label: "Insights da IA",
      description: "Receba análises e sugestões do assistente.",
    },
  ];
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

  protected markAllAsRead() {
    this.notificationCenter
      .notifications()
      .filter((item) => !item.isRead)
      .forEach((item) => this.notificationCenter.markAsRead(item.id));
  }
}
