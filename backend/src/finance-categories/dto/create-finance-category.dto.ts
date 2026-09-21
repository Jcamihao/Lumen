import { TransactionType } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

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

  /** Teto mensal de gastos da categoria. `null` remove o orcamento. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999)
  monthlyBudget?: number | null;
}
