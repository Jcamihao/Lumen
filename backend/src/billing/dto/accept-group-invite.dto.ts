import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AcceptGroupInviteDto {
  @ApiProperty({ description: 'Token do convite (vem so uma vez, na criacao).' })
  @IsString()
  @MinLength(20)
  token!: string;
}
