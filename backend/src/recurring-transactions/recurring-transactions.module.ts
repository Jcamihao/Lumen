import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { RecurringMaterializerModule } from './recurring-materializer.module';
import { RecurringTransactionsController } from './recurring-transactions.controller';
import { RecurringTransactionsService } from './recurring-transactions.service';

@Module({
  imports: [BillingModule, LifeEngineModule, RecurringMaterializerModule],
  controllers: [RecurringTransactionsController],
  providers: [RecurringTransactionsService],
  exports: [RecurringTransactionsService],
})
export class RecurringTransactionsModule {}
