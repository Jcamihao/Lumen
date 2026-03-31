import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "path";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AssistantModule } from "./assistant/assistant.module";
import { AuthModule } from "./auth/auth.module";
import { CacheQueueModule } from "./cache-queue/cache-queue.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RateLimitGuard } from "./common/guards/rate-limit.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { appConfig } from "./config/app.config";
import { authConfig } from "./config/auth.config";
import { cacheConfig } from "./config/cache.config";
import { mailConfig } from "./config/mail.config";
import { DashboardModule } from "./dashboard/dashboard.module";
import { FinanceCategoriesModule } from "./finance-categories/finance-categories.module";
import { ForecastsModule } from "./forecasts/forecasts.module";
import { GoalsModule } from "./goals/goals.module";
import { ImportsModule } from "./imports/imports.module";
import { InsightsModule } from "./insights/insights.module";
import { LifeEngineModule } from "./life-engine/life-engine.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RemindersModule } from "./reminders/reminders.module";
import { TaskCategoriesModule } from "./task-categories/task-categories.module";
import { TasksModule } from "./tasks/tasks.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { SupportRequestsModule } from "./support-requests/support-requests.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(__dirname, "../.env"),
        resolve(__dirname, "../.env.example"),
      ],
      load: [appConfig, authConfig, cacheConfig, mailConfig],
    }),
    PrismaModule,
    CacheQueueModule,
    UsersModule,
    AuthModule,
    TaskCategoriesModule,
    FinanceCategoriesModule,
    TasksModule,
    TransactionsModule,
    GoalsModule,
    RemindersModule,
    InsightsModule,
    ForecastsModule,
    NotificationsModule,
    SupportRequestsModule,
    DashboardModule,
    ImportsModule,
    AssistantModule,
    LifeEngineModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
export class AppModule {}
