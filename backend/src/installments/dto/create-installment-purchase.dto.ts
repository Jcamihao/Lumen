import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

  /** Cartao das parcelas (so com paymentMethod=CREDIT). Sem cardId, conta no cartao padrao. */
  @ApiPropertyOptional({ format: 'uuid', description: 'Cartao das parcelas; so com paymentMethod=CREDIT.' })
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @ApiPropertyOptional({
    description: 'Vencimento da 1a parcela (AAAA-MM-DD). Default: hoje.',
    example: '2026-10-05',
  })
  @IsOptional()
  @IsDateString()
  firstDueDate?: string;
}
