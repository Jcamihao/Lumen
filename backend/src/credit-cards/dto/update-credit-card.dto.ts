import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateCreditCardDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 40 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  closingDay?: number;

  /** null remove o dia de vencimento. */
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number | null;

  /** true so no cartao padrao; no cartao padrao, false desliga. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  countAllPayments?: boolean;
}
