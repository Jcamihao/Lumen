import { Transform } from 'class-transformer';
import { Equals, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class ConfirmConversationDraftDto {
  @IsUUID()
  draftId!: string;

  @IsInt()
  @Min(1)
  draftVersion!: number;

  /** Só `true` vale: confirmação explícita de apagar pelo botão (contrato 8a, secao 4). Ausente = não apaga. */
  // O pipe global usa enableImplicitConversion (Boolean("false") seria true): vale só o booleano literal do corpo.
  @Transform(({ obj }: { obj: { delete?: unknown } }) => obj.delete)
  @IsOptional()
  @Equals(true)
  delete?: true;

  /** Só `true` vale: confirmação explícita de limpar o teto pelo botão (contrato 8d, D3). Ausente = não limpa. */
  // Mesma regra do delete: com enableImplicitConversion no pipe global, só o booleano literal do corpo vale.
  @Transform(({ obj }: { obj: { clear?: unknown } }) => obj.clear)
  @IsOptional()
  @Equals(true)
  clear?: true;
}
