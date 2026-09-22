import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Frequencia e dia de vencimento nao mudam depois de criar (apague e crie de
 * novo): mexer nisso reescreveria o calendario ja gerado.
 */
export class UpdateRecurringTransactionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999)
  amount?: number;

  @ApiPropertyOptional({ nullable: true, description: 'null remove a categoria.' })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'null remove a forma de pagamento.' })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'null remove a data final.' })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;
}
