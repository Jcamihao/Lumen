import { NotificationType } from "@prisma/client";
import type { Job } from "bullmq";
import { InsightsService } from "../../insights/insights.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { InsightEscalation } from "./insight-escalation";

function insightNotificationTitle(metadata: unknown) {
  const persona = (metadata as { persona?: { name?: string } } | null)?.persona?.name;

  return persona ? `${persona} encontrou algo` : "Alerta importante do LUMEN";
}

export class InsightsRefreshProcessor {
  constructor(
    private readonly insightsService: InsightsService,
    private readonly notificationsService: NotificationsService,
    private readonly escalation: InsightEscalation,
  ) {}

  async refresh(job: Job) {
    const userId = String(job.data.userId);

    await this.insightsService.refreshForUser(userId);
    await this.notifyPending(userId);
    await this.escalation.escalate(userId);
  }

  // So notifica o que ainda nao foi avisado. Antes, o refresh recriava
  // todos os insights a cada ciclo, entao o mesmo alerta critico virava
  // notificacao nova toda vez que a fila rodava.
  private async notifyPending(userId: string) {
    const pending = await this.insightsService.takePendingNotifications(userId);

    for (const insight of pending) {
      await this.notificationsService.createNotification(
        userId,
        NotificationType.INSIGHT,
        insightNotificationTitle(insight.metadata),
        insight.message,
      );
    }
  }
}
