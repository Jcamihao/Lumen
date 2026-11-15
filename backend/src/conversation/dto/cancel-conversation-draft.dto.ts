import { IsUUID } from 'class-validator';

export class CancelConversationDraftDto {
  @IsUUID()
  draftId!: string;
}
