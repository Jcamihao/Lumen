import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [BillingModule, LifeEngineModule, NotificationsModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
