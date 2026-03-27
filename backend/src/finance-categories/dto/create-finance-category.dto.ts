import { TransactionType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateFinanceCategoryDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  color!: string;

  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsOptional()
  @IsString()
  icon?: string;
}
