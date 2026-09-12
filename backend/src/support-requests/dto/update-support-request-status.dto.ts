import { SupportRequestStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateSupportRequestStatusDto {
  @IsEnum(SupportRequestStatus)
  status!: SupportRequestStatus;
}
