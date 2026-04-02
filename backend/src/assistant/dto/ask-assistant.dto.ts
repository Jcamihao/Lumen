import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AskAssistantHistoryItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(600)
  question!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  answer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  focusArea?: string;

  @IsOptional()
  @IsISO8601()
  createdAt?: string;
}

export class AskAssistantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  question!: string;

  @IsOptional()
  @IsString()
  @IsIn(['dashboard', 'tasks', 'finances', 'goals', 'imports', 'general'])
  originModule?: 'dashboard' | 'tasks' | 'finances' | 'goals' | 'imports' | 'general';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => AskAssistantHistoryItemDto)
  history?: AskAssistantHistoryItemDto[];
}
