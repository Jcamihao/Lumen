import { Module } from '@nestjs/common';
import { CreditCycleModule } from '../credit-cycle/credit-cycle.module';
import { DashboardModule } from '../dashboard/dashboard.module';
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
  ],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
