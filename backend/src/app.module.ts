import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "path";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AssistantModule } from "./assistant/assistant.module";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { CacheQueueModule } from "./cache-queue/cache-queue.module";
import { CreditCardsModule } from "./credit-cards/credit-cards.module";
import { CreditCycleModule } from "./credit-cycle/credit-cycle.module";
import { ConversationModule } from "./conversation/conversation.module";
import { EnvelopesModule } from "./envelopes/envelopes.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RateLimitGuard } from "./common/guards/rate-limit.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { appConfig } from "./config/app.config";
import { asaasConfig } from "./config/asaas.config";
import { authConfig } from "./config/auth.config";
import { cacheConfig } from "./config/cache.config";
import { mailConfig } from "./config/mail.config";
import { whatsappConfig } from "./whatsapp/whatsapp.config";
import { WhatsappModule } from "./whatsapp/whatsapp.module";
import { telegramConfig } from "./telegram/telegram.config";
import { TelegramModule } from "./telegram/telegram.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { EmailPreferencesModule } from "./email-preferences/email-preferences.module";
import { FinanceCategoriesModule } from "./finance-categories/finance-categories.module";
import { ForecastsModule } from "./forecasts/forecasts.module";
import { GoalsModule } from "./goals/goals.module";
import { ImportsModule } from "./imports/imports.module";
import { InsightsModule } from "./insights/insights.module";
import { InstallmentsModule } from "./installments/installments.module";
import { LifeEngineModule } from "./life-engine/life-engine.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RecurringTransactionsModule } from "./recurring-transactions/recurring-transactions.module";
import { RemindersModule } from "./reminders/reminders.module";
import { TaskCategoriesModule } from "./task-categories/task-categories.module";
import { TagGroupsModule } from "./tag-groups/tag-groups.module";
import { TasksModule } from "./tasks/tasks.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { SupportRequestsModule } from "./support-requests/support-requests.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(__dirname, "../../.env"),
        resolve(__dirname, "../../.env.example"),
      ],
      load: [appConfig, authConfig, cacheConfig, mailConfig, asaasConfig, whatsappConfig, telegramConfig],
    }),
    PrismaModule,
    CacheQueueModule,
    UsersModule,
    EmailPreferencesModule,
    AuthModule,
    TaskCategoriesModule,
    TagGroupsModule,
    FinanceCategoriesModule,
    TasksModule,
    TransactionsModule,
    RecurringTransactionsModule,
    InstallmentsModule,
    CreditCycleModule,
    CreditCardsModule,
    EnvelopesModule,
    GoalsModule,
    RemindersModule,
    InsightsModule,
    ForecastsModule,
    NotificationsModule,
    SupportRequestsModule,
    DashboardModule,
    ImportsModule,
    AssistantModule,
    ConversationModule,
    WhatsappModule,
    TelegramModule,
    LifeEngineModule,
    BillingModule,
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
