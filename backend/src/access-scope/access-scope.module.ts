import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { AccessScopeService } from './access-scope.service';

@Module({
  imports: [BillingModule],
  providers: [AccessScopeService],
  exports: [AccessScopeService],
})
export class AccessScopeModule {}
