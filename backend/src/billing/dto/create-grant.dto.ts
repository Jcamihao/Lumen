import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsIn, IsOptional } from 'class-validator';

export class CreateGrantDto {
  @ApiProperty({ example: 'pessoa@exemplo.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['INDIVIDUAL'] })
  @IsIn(['INDIVIDUAL'])
  plan!: 'INDIVIDUAL';

  @ApiPropertyOptional({ description: 'Fim da concessão (ISO). Omitido = sem fim.' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
