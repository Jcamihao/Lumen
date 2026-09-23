import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateCreditCycleSettingsDto {
  /** null remove o dia de vencimento (o dia de fechamento fica em /users/me, e' o mesmo monthClosingDay). */
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
