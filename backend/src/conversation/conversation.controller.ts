import { Body, Controller, Get, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CancelConversationDraftDto } from './dto/cancel-conversation-draft.dto';
import { ConfirmConversationDraftDto } from './dto/confirm-conversation-draft.dto';
import { SendConversationMessageDto } from './dto/send-conversation-message.dto';
import { ConversationService } from './conversation.service';

const DRAFT_NOT_FOUND = 'Rascunho não encontrado';

/** Canal APP fixo aqui. userId vem so do JWT, nunca do corpo. */
@ApiTags('conversation')
@ApiBearerAuth()
@Controller('conversation')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Post('message')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mensagem digitada no assistente de Finanças' })
  message(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendConversationMessageDto) {
    return this.conversationService.handleMessage({
      userId: user.sub,
      channel: 'APP',
      messageId: dto.messageId,
      text: dto.text,
      receivedAt: new Date(),
    });
  }

  @Post('confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirma o rascunho (botao Confirmar)' })
  async confirm(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConfirmConversationDraftDto) {
    const reply = await this.conversationService.confirmDraft(user.sub, dto.draftId, dto.draftVersion, dto.delete === true);
    if (!reply) {
      throw new NotFoundException(DRAFT_NOT_FOUND);
    }
    return reply;
  }

  @Post('cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancela o rascunho (botao Cancelar)' })
  async cancel(@CurrentUser() user: AuthenticatedUser, @Body() dto: CancelConversationDraftDto) {
    const reply = await this.conversationService.cancelDraft(user.sub, dto.draftId);
    if (!reply) {
      throw new NotFoundException(DRAFT_NOT_FOUND);
    }
    return reply;
  }

  @Get('session')
  @ApiOperation({ summary: 'Estado atual da conversa do canal APP' })
  session(@CurrentUser() user: AuthenticatedUser) {
    return this.conversationService.getSession(user.sub);
  }
}
