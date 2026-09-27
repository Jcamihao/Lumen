import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { InstallmentMaterializerModule } from './installment-materializer.module';
import { InstallmentsController } from './installments.controller';
import { InstallmentsService } from './installments.service';

@Module({
  imports: [BillingModule, LifeEngineModule, InstallmentMaterializerModule],
  controllers: [InstallmentsController],
  providers: [InstallmentsService],
  exports: [InstallmentsService],
})
export class InstallmentsModule {}
