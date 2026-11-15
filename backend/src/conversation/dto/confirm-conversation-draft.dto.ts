import { IsInt, IsUUID, Min } from 'class-validator';

export class ConfirmConversationDraftDto {
  @IsUUID()
  draftId!: string;

  @IsInt()
  @Min(1)
  draftVersion!: number;
}
