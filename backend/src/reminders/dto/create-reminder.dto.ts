import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateReminderDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsDateString()
  remindAt!: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsString()
  goalId?: string;
}
