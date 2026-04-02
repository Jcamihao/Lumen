import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { GoalsModule } from '../goals/goals.module';
import { RemindersModule } from '../reminders/reminders.module';
import { TasksModule } from '../tasks/tasks.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [DashboardModule, TasksModule, GoalsModule, RemindersModule],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
