import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CreateEnvelopeDto } from './create-envelope.dto';

/** `monthlyAmount`: so vale a partir do proximo deposito (mes atual, se ainda nao foi gerado; senao o seguinte). */
export class UpdateEnvelopeDto extends PartialType(OmitType(CreateEnvelopeDto, ['icon'] as const)) {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  icon?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
