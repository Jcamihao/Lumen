import { Equals, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class ConfirmConversationDraftDto {
  @IsUUID()
  draftId!: string;

  @IsInt()
  @Min(1)
  draftVersion!: number;

  /** Só `true` vale: confirmação explícita de apagar pelo botão (contrato 8a, secao 4). Ausente = não apaga. */
  @IsOptional()
  @Equals(true)
  delete?: true;
}
