import { PaymentMethod, TransactionType } from '@prisma/client';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateTransactionDto {
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsString()
  @MinLength(2)
  description?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  linkedTaskId?: string | null;

  @IsOptional()
  @IsString()
  linkedGoalId?: string | null;

  /** `null` limpa a forma de pagamento. */
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod | null;
}
