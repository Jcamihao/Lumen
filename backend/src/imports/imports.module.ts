import { Module } from '@nestjs/common';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [LifeEngineModule, NotificationsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
  exports: [ImportsService],
})
export class ImportsModule {}
