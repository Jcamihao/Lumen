import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';

@Module({
  controllers: [BillingController],
  providers: [EntitlementsService, BillingService],
  exports: [EntitlementsService, BillingService],
})
export class BillingModule {}
