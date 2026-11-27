import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { GoalsModule } from '../goals/goals.module';
import { RemindersModule } from '../reminders/reminders.module';
import { TasksModule } from '../tasks/tasks.module';
import { AssistantController } from './assistant.controller';
import { AssistantActionsService } from './actions/assistant-actions.service';
import { AssistantService } from './assistant.service';
import { AssistantHistoryService } from './history/assistant-history.service';
import { SelahClient } from './selah/selah.client';
import { SelahSettings } from './selah/selah-settings';

@Module({
  imports: [DashboardModule, TasksModule, GoalsModule, RemindersModule, BillingModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantActionsService, AssistantHistoryService, SelahClient, SelahSettings],
  exports: [AssistantService],
})
export class AssistantModule {}
