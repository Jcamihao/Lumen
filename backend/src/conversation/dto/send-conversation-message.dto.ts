import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendConversationMessageDto {
  @IsUUID()
  messageId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;
}
