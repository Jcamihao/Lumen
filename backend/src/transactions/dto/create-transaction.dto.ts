import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, TransactionType } from '@prisma/client';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateTransactionDto {
  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsString()
  @MinLength(2)
  description!: string;

  @IsNumber()
  amount!: number;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  linkedTaskId?: string;

  @IsOptional()
  @IsString()
  linkedGoalId?: string;

  /** PIX, credito ou debito (opcional). */
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  /** Cartao usado (so com paymentMethod=CREDIT). Sem cardId, o lancamento conta no cartao padrao. */
  @ApiPropertyOptional({ format: 'uuid', description: 'Cartao usado; so com paymentMethod=CREDIT.' })
  @IsOptional()
  @IsUUID()
  cardId?: string;

  /** Marca o gasto como parte de um envelope (ex.: gasolina). */
  @IsOptional()
  @IsString()
  envelopeId?: string;
}
