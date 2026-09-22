import { IsNumber, Max, Min } from 'class-validator';

export class SetCreditCycleCeilingDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999)
  ceiling!: number;
}
