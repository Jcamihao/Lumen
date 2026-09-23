import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateInstallmentPurchaseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  description!: string;

  /** Valor total da compra; cada parcela sai de totalAmount / installmentsTotal. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999)
  totalAmount!: number;

  @IsInt()
  @Min(2)
  @Max(60)
  installmentsTotal!: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  /** As parcelas geradas herdam esta forma de pagamento (tipicamente CREDIT). */
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Vencimento da 1a parcela (AAAA-MM-DD). Default: hoje.',
    example: '2026-10-05',
  })
  @IsOptional()
  @IsDateString()
  firstDueDate?: string;
}
