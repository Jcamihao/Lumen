import { OmitType, PartialType } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto';

export class UpdateTransactionDto extends PartialType(
  OmitType(CreateTransactionDto, [
    'categoryId',
    'linkedTaskId',
    'linkedGoalId',
    'paymentMethod',
    'envelopeId',
  ] as const),
) {
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

  /** `null` remove o envelope. */
  @IsOptional()
  @IsString()
  envelopeId?: string | null;
}
