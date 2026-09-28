import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class CreateCheckoutDto {
  @ApiProperty({ enum: ['INDIVIDUAL', 'SHARED'] })
  @IsIn(['INDIVIDUAL', 'SHARED'])
  plan!: 'INDIVIDUAL' | 'SHARED';

  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'] })
  @IsIn(['MONTHLY', 'YEARLY'])
  interval!: 'MONTHLY' | 'YEARLY';
}
