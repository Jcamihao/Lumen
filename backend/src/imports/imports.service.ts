import { Injectable } from '@nestjs/common';
import { CommitImportDto } from './dto/commit-import.dto';
import { CommitReceiptImportDto } from './dto/commit-receipt-import.dto';
import { PreviewReceiptImportDto } from './dto/preview-receipt-import.dto';
import { TransactionsImportService } from './csv-import/transactions-import.service';
import { ImportHistoryService } from './import-history.service';
import { ReceiptCommitService } from './receipt-import/receipt-commit.service';
import { ReceiptImportService } from './receipt-import/receipt-import.service';

/** Porta de entrada das importacoes: so encaminha para o servico de cada responsabilidade. */
@Injectable()
export class ImportsService {
  constructor(
    private readonly history: ImportHistoryService,
    private readonly transactions: TransactionsImportService,
    private readonly receiptImport: ReceiptImportService,
    private readonly receiptCommit: ReceiptCommitService,
  ) {}

  listReceiptScans(userId: string) {
    return this.history.listReceiptScans(userId);
  }

  listImportJobs(userId: string) {
    return this.history.listImportJobs(userId);
  }

  previewTransactionsImport(userId: string, file?: Express.Multer.File) {
    return this.transactions.preview(userId, file);
  }

  commitTransactionsImport(userId: string, dto: CommitImportDto) {
    return this.transactions.commit(userId, dto);
  }

  previewReceiptImport(userId: string, file: Express.Multer.File | undefined, dto: PreviewReceiptImportDto) {
    return this.receiptImport.preview(userId, file, dto);
  }

  commitReceiptImport(userId: string, dto: CommitReceiptImportDto) {
    return this.receiptCommit.commit(userId, dto);
  }
}
