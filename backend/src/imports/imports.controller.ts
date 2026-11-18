import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CommitImportDto } from './dto/commit-import.dto';
import { CommitReceiptImportDto } from './dto/commit-receipt-import.dto';
import { PreviewReceiptImportDto } from './dto/preview-receipt-import.dto';
import { CSV_IMPORT_MAX_BYTES, RECEIPT_PDF_MAX_BYTES } from './imports.constants';
import { ImportsService } from './imports.service';

@ApiTags('imports')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get('receipts')
  @ApiOperation({ summary: 'Lista historico de notas fiscais importadas' })
  listReceipts(@CurrentUser() user: AuthenticatedUser) {
    return this.importsService.listReceiptScans(user.sub);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Lista historico de importacoes CSV' })
  listTransactionImports(@CurrentUser() user: AuthenticatedUser) {
    return this.importsService.listImportJobs(user.sub);
  }

  @Post('transactions/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CSV_IMPORT_MAX_BYTES, files: 1, fields: 10 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Faz preview da importacao CSV com deduplicacao' })
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.importsService.previewTransactionsImport(user.sub, file);
  }

  @Post('transactions/commit')
  @ApiOperation({ summary: 'Confirma importacao CSV de transacoes' })
  commit(@CurrentUser() user: AuthenticatedUser, @Body() dto: CommitImportDto) {
    return this.importsService.commitTransactionsImport(user.sub, dto);
  }

  @Post('receipts/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: RECEIPT_PDF_MAX_BYTES, files: 1, fields: 10 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Faz preview de nota fiscal (QR, PDF com texto ou OCR) com itens extraidos' })
  previewReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PreviewReceiptImportDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.importsService.previewReceiptImport(user.sub, file, dto);
  }

  @Post('receipts/commit')
  @ApiOperation({ summary: 'Confirma a importacao de uma nota fiscal lida no LUMEN' })
  commitReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CommitReceiptImportDto,
  ) {
    return this.importsService.commitReceiptImport(user.sub, dto);
  }
}
