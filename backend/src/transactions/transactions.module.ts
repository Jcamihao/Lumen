import { Module } from '@nestjs/common';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { RecurringMaterializerModule } from '../recurring-transactions/recurring-materializer.module';
import { InstallmentMaterializerModule } from '../installments/installment-materializer.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [LifeEngineModule, RecurringMaterializerModule, InstallmentMaterializerModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
