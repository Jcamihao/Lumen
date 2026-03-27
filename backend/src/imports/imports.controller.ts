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
}
