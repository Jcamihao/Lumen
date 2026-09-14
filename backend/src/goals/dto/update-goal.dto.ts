import { GoalStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  targetAmount?: number;

  @IsOptional()
  @IsNumber()
  currentAmount?: number;

  @IsOptional()
  @IsDateString()
  targetDate?: string | null;

  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

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
