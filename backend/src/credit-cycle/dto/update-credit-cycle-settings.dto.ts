import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateCreditCycleSettingsDto {
  /** null remove o dia de vencimento. Dia de fechamento e' do cartao (PUT /credit-cards/:id). */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number | null;

  /** true: o teto soma toda despesa do ciclo (credito+debito+PIX+boleto), nao so credito. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  countAllPayments?: boolean;
}
