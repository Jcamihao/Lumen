import { NotificationType } from "@prisma/client";
import type { Job } from "bullmq";
import { ForecastsService } from "../../forecasts/forecasts.service";
import { NotificationsService } from "../../notifications/notifications.service";

export class ForecastRefreshProcessor {
  constructor(
    private readonly forecastsService: ForecastsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async refresh(job: Job) {
    const userId = String(job.data.userId);
    const forecast = await this.forecastsService.recalculateForUser(userId);

    if (forecast.riskLevel === "HIGH") {
      await this.notificationsService.createNotification(
        userId,
        NotificationType.FORECAST,
        "Risco financeiro elevado",
        "Sua previsao financeira indica risco alto para os proximos 30 dias.",
      );
    }
  }
}
