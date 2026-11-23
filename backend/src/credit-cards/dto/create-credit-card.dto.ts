import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateCreditCardDto {
  @ApiProperty({ minLength: 1, maxLength: 40, description: 'Nome do cartao (aparado; sem diferenciar maiuscula)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @ApiProperty({ minimum: 1, maximum: 31, description: 'Dia de fechamento do ciclo' })
  @IsInt()
  @Min(1)
  @Max(31)
  closingDay!: number;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 31, description: 'Dia de vencimento da fatura' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number | null;

  @ApiPropertyOptional({ description: 'So aceito como false: somar todos os pagamentos e so do cartao padrao' })
  @IsOptional()
  @IsBoolean()
  countAllPayments?: boolean;
}
