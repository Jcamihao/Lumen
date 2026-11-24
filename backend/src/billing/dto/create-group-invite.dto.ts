import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class CreateGroupInviteDto {
  @ApiProperty({ example: 'pessoa@exemplo.com', description: 'E-mail do convidado.' })
  @IsEmail()
  email!: string;
}
