import { Module } from '@nestjs/common';
import { AsaasClient } from './asaas-client';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';

@Module({
  controllers: [BillingController],
  providers: [EntitlementsService, BillingService, AsaasClient],
  exports: [EntitlementsService, BillingService, AsaasClient],
})
export class BillingModule {}
