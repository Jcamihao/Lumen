import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsIn, IsOptional } from 'class-validator';

export class CreateGrantDto {
  @ApiProperty({ example: 'pessoa@exemplo.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['INDIVIDUAL', 'SHARED'], description: 'D9: concessao SHARED vale como assinatura comum (beneficiado vira pagador).' })
  @IsIn(['INDIVIDUAL', 'SHARED'])
  plan!: 'INDIVIDUAL' | 'SHARED';

  @ApiPropertyOptional({ description: 'Fim da concessão (ISO). Omitido = sem fim.' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
