import {
  SupportRequestSeverity,
  SupportRequestType,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FEEDBACK_AREAS } from '../feedback-areas';

export class CreateSupportRequestDto {
  @IsEnum(SupportRequestType)
  type!: SupportRequestType;

  @IsString()
  @MinLength(4)
  @MaxLength(120)
  subject!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(5000)
  message!: string;

  @IsOptional()
  @IsEnum(SupportRequestSeverity)
  severity?: SupportRequestSeverity;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  screenPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deviceInfo?: string;

  /** Nota geral de 1 a 5 (pagina de feedback). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsIn(FEEDBACK_AREAS)
  area?: string;

  @IsOptional()
  @IsBoolean()
  canContact?: boolean;
}
