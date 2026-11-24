import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { TelegramBotClient } from './telegram-bot.client';
import { TelegramLinkService } from './telegram-link.service';

/**
 * Rotas do vinculo Telegram (contrato 10, D1), espelho das do WhatsApp. Nao ha webhook: o transporte
 * e long polling (D2), iniciado pelo proprio backend quando TELEGRAM_ENABLED=true.
 */
@ApiTags('telegram')
@ApiBearerAuth()
@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly links: TelegramLinkService,
    private readonly client: TelegramBotClient,
  ) {}

  @Post('link-code')
  @ApiOperation({ summary: 'Gera codigo de vinculo do Telegram (uso unico, 10 min)' })
  linkCode(@CurrentUser() user: AuthenticatedUser) {
    return this.links.createCode(user.sub);
  }

  @Get('status')
  @ApiOperation({ summary: 'Estado do vinculo do Telegram da conta logada (chat mascarado + @ do bot)' })
  async status(@CurrentUser() user: AuthenticatedUser) {
    const status = await this.links.getStatus(user.sub);
    const username = status.enabled ? await this.client.getBotUsername() : null;
    return { ...status, ...(username ? { botUsername: username } : {}) };
  }

  @Delete('link')
  @HttpCode(204)
  @ApiOperation({ summary: 'Desvincula o Telegram da conta logada (idempotente)' })
  async unlink(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.links.unlinkByUserId(user.sub);
  }
}
