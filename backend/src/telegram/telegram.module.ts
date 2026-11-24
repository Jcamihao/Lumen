import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { TelegramAdapterService } from './telegram-adapter.service';
import { TelegramBotClient } from './telegram-bot.client';
import { TelegramController } from './telegram.controller';
import { TelegramLinkService } from './telegram-link.service';

@Module({
  imports: [ConversationModule],
  controllers: [TelegramController],
  providers: [TelegramLinkService, TelegramAdapterService, TelegramBotClient],
  exports: [TelegramLinkService],
})
export class TelegramModule {}
