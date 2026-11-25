import { Module } from '@nestjs/common';
import { AsaasClient } from './asaas-client';
import { BillingController } from './billing.controller';
import { BillingPaymentsService } from './billing-payments.service';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';
import { GroupController } from './group.controller';
import { GroupService } from './group.service';

@Module({
  controllers: [BillingController, GroupController],
  providers: [EntitlementsService, BillingService, BillingPaymentsService, AsaasClient, GroupService],
  exports: [EntitlementsService, BillingService, BillingPaymentsService, AsaasClient],
})
export class BillingModule {}
