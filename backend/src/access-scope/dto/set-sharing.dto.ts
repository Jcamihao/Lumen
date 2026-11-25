import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetSharingDto {
  @ApiProperty({ description: 'true marca como compartilhado com o grupo; false volta a ser privado.' })
  @IsBoolean()
  shared!: boolean;
}
