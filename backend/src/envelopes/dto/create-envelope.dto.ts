import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateEnvelopeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsString()
  color!: string;

  @IsOptional()
  @IsString()
  icon?: string;

  /** Valor que recarrega o envelope todo mes. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999)
  monthlyAmount!: number;
}
