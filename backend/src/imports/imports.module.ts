import { Module } from '@nestjs/common';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ReceiptExtractorService } from './receipt-extractor.service';
import { OcrPool } from './receipt-readers';

@Module({
  imports: [LifeEngineModule, NotificationsModule],
  controllers: [ImportsController],
  providers: [ImportsService, ReceiptExtractorService, OcrPool],
  exports: [ImportsService],
})
export class ImportsModule {}
