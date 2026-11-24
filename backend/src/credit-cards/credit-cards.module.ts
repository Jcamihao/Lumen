import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CreditCycleModule } from '../credit-cycle/credit-cycle.module';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { CreditCardsController } from './credit-cards.controller';
import { CreditCardsService } from './credit-cards.service';

@Module({
  imports: [BillingModule, LifeEngineModule, CreditCycleModule],
  controllers: [CreditCardsController],
  providers: [CreditCardsService],
  exports: [CreditCardsService],
})
export class CreditCardsModule {}
