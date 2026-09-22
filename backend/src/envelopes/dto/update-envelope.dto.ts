import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateEnvelopeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  icon?: string | null;

  /** So vale a partir do proximo deposito (mes atual, se ainda nao foi gerado; senao o seguinte). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999)
  monthlyAmount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
