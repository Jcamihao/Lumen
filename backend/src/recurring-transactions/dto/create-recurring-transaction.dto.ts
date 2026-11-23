import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, RecurrenceFrequency, TransactionType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRecurringTransactionDto {
  @ApiProperty({ enum: [TransactionType.EXPENSE, TransactionType.INCOME] })
  @IsIn([TransactionType.EXPENSE, TransactionType.INCOME])
  type!: TransactionType;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999)
  amount!: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Os lancamentos gerados herdam esta forma de pagamento. */
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  /** Os lancamentos gerados herdam o cartao (so com paymentMethod=CREDIT). Sem cardId, usam o padrao. */
  @ApiPropertyOptional({ format: 'uuid', description: 'Cartao das cobrancas; so com paymentMethod=CREDIT.' })
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @ApiProperty({ enum: RecurrenceFrequency })
  @IsEnum(RecurrenceFrequency)
  frequency!: RecurrenceFrequency;

  @ApiProperty({ description: 'Primeiro vencimento (AAAA-MM-DD).', example: '2026-10-05' })
  @IsDateString()
  firstDueDate!: string;

  @ApiPropertyOptional({ description: 'Ultimo dia em que a conta ainda pode vencer.' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
