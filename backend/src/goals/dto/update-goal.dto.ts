import { GoalStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

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
}
