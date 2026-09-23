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

export class CreateGoalDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Ausente/null = meta sem valor-alvo (cofrinho sem proposito, ex.: reserva de emergencia). */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  targetAmount?: number | null;

  @IsOptional()
  @IsNumber()
  currentAmount?: number;

  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  recurringAmount?: number;

  /** Dia do mes (1-28, evita meses curtos) em que o aporte automatico roda. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  recurringDay?: number;
}
