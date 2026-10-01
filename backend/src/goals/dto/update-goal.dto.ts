import { OmitType, PartialType } from '@nestjs/swagger';
import { IsDateString, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { CreateGoalDto } from './create-goal.dto';

export class UpdateGoalDto extends PartialType(
  OmitType(CreateGoalDto, ['targetDate', 'recurringAmount', 'recurringDay'] as const),
) {
  @IsOptional()
  @IsDateString()
  targetDate?: string | null;

  /** null remove o aporte automatico configurado. */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  recurringAmount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  recurringDay?: number | null;
}
