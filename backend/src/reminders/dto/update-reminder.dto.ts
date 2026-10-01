import { OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateReminderDto } from './create-reminder.dto';

export class UpdateReminderDto extends PartialType(
  OmitType(CreateReminderDto, ['taskId', 'transactionId', 'goalId'] as const),
) {
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
