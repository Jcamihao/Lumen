import { Module } from '@nestjs/common';
import { AsaasClient } from './asaas-client';
import { BillingController } from './billing.controller';
import { BillingPaymentsService } from './billing-payments.service';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';

@Module({
  controllers: [BillingController],
  providers: [EntitlementsService, BillingService, BillingPaymentsService, AsaasClient],
  exports: [EntitlementsService, BillingService, BillingPaymentsService, AsaasClient],
})
export class BillingModule {}
