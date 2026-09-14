import { Module } from "@nestjs/common";
import { CacheQueueModule } from "../cache-queue/cache-queue.module";
import { ForecastsModule } from "../forecasts/forecasts.module";
import { InsightsModule } from "../insights/insights.module";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { LifeEngineService } from "./life-engine.service";
import { LifeWorkersService } from "./life-workers.service";

@Module({
  // CacheQueueModule e @Global (disponivel via DI em qualquer lugar sem
  // import), mas @Global nao garante ORDEM de inicializacao — so um import
  // explicito faz o Nest esperar o onModuleInit do Redis terminar antes do
  // onModuleInit do LifeWorkersService rodar. Sem isso, dependendo da
  // corrida, os workers desistiam achando o Redis indisponivel mesmo ele
  // conectando corretamente logo em seguida.
  imports: [
    CacheQueueModule,
    InsightsModule,
    ForecastsModule,
    NotificationsModule,
    MailModule,
  ],
  providers: [LifeEngineService, LifeWorkersService],
  exports: [LifeEngineService],
})
export class LifeEngineModule {}
