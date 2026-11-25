import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class SetSharingDto {
  @ApiProperty({ description: 'true marca como compartilhado com o grupo; false volta a ser privado.' })
  // O pipe global converte tipos de forma implicita: sem isto, a string "false" viraria true e compartilharia.
  @Transform(({ obj }) => obj.shared)
  @IsBoolean()
  shared!: boolean;
}
