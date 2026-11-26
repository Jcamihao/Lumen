import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ReadScopeQueryDto } from '../../access-scope/dto/read-scope-query.dto';

export class ListCreditCardsQueryDto extends ReadScopeQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'true inclui cartoes arquivados (historico)' })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeArchived?: 'true' | 'false';
}
