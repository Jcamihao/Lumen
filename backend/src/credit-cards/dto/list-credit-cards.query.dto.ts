import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class ListCreditCardsQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'true inclui cartoes arquivados (historico)' })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeArchived?: 'true' | 'false';
}
