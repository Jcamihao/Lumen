import {
  SupportRequestSeverity,
  SupportRequestType,
} from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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
}
