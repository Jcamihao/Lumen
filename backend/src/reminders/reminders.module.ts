import { Module } from '@nestjs/common';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [LifeEngineModule],
  controllers: [RemindersController],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
