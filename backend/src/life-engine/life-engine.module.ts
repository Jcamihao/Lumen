import { Module } from "@nestjs/common";
import { ForecastsModule } from "../forecasts/forecasts.module";
import { InsightsModule } from "../insights/insights.module";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { LifeEngineService } from "./life-engine.service";
import { LifeWorkersService } from "./life-workers.service";

@Module({
  imports: [InsightsModule, ForecastsModule, NotificationsModule, MailModule],
  providers: [LifeEngineService, LifeWorkersService],
  exports: [LifeEngineService],
})
export class LifeEngineModule {}
