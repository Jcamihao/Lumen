import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { READ_SCOPES, ReadScope } from '../read-scope';

export class ReadScopeQueryDto {
  @ApiPropertyOptional({ enum: READ_SCOPES, description: 'mine (padrao), shared ou all.' })
  @IsOptional()
  @IsIn(READ_SCOPES)
  scope?: ReadScope;
}
