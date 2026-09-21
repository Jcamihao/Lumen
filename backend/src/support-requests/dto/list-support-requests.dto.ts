import { SupportRequestStatus, SupportRequestType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class ListSupportRequestsDto {
  @IsOptional()
  @IsEnum(SupportRequestStatus)
  status?: SupportRequestStatus;

  @IsOptional()
  @IsEnum(SupportRequestType)
  type?: SupportRequestType;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;
}
