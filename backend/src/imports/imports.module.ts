import { Module } from '@nestjs/common';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { TransactionsImportService } from './csv-import/transactions-import.service';
import { ImportHistoryService } from './import-history.service';
import { ReceiptCommitService } from './receipt-import/receipt-commit.service';
import { ReceiptDuplicateFinder } from './receipt-import/receipt-duplicate.finder';
import { ReceiptImportService } from './receipt-import/receipt-import.service';
import { ReceiptPreviewSerializer } from './receipt-import/receipt-preview.serializer';
import { ReceiptPriceHistoryService } from './receipt-import/receipt-price-history.service';
import { ReceiptExtractorService } from './receipt-extractor.service';
import { OcrPool } from './receipt-readers';

@Module({
  imports: [LifeEngineModule, NotificationsModule],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    ImportHistoryService,
    TransactionsImportService,
    ReceiptImportService,
    ReceiptCommitService,
    ReceiptDuplicateFinder,
    ReceiptPriceHistoryService,
    ReceiptPreviewSerializer,
    ReceiptExtractorService,
    OcrPool,
  ],
  exports: [ImportsService],
})
export class ImportsModule {}
