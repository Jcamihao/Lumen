import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateReminderDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsDateString()
  remindAt?: string;

  @IsOptional()
  @IsString()
  taskId?: string | null;

  @IsOptional()
  @IsString()
  transactionId?: string | null;

  @IsOptional()
  @IsString()
  goalId?: string | null;
}
