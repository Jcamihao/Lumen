import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { BillingModule } from '../billing/billing.module';
import { CreditCycleModule } from '../credit-cycle/credit-cycle.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { EnvelopesModule } from '../envelopes/envelopes.module';
import { GoalsModule } from '../goals/goals.module';
import { InstallmentsModule } from '../installments/installments.module';
import { RecurringTransactionsModule } from '../recurring-transactions/recurring-transactions.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

@Module({
  imports: [
    TransactionsModule,
    DashboardModule,
    CreditCycleModule,
    GoalsModule,
    InstallmentsModule,
    RecurringTransactionsModule,
    EnvelopesModule,
    BillingModule,
    AssistantModule,
  ],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
