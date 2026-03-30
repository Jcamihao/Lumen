import {
  Body,
  Controller,
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
import { ImportsService } from './imports.service';

@ApiTags('imports')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('transactions/preview')
  @UseInterceptors(FileInterceptor('file'))
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
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Faz preview de nota fiscal por IA com itens extraidos da imagem' })
  previewReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.importsService.previewReceiptImport(user.sub, file);
  }

  @Post('receipts/commit')
  @ApiOperation({ summary: 'Confirma a importacao de uma nota fiscal lida por IA' })
  commitReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CommitReceiptImportDto,
  ) {
    return this.importsService.commitReceiptImport(user.sub, dto);
  }
}
