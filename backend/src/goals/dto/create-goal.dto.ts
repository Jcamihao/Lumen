import { GoalStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateGoalDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  targetAmount!: number;

  @IsOptional()
  @IsNumber()
  currentAmount?: number;

  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;
}
