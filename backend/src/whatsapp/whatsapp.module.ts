import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { WhatsappAdapterService } from './whatsapp-adapter.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappLinkService } from './whatsapp-link.service';
import { WaAkgClient } from './wa-akg.client';

@Module({
  imports: [ConversationModule],
  controllers: [WhatsappController],
  providers: [WhatsappLinkService, WhatsappAdapterService, WaAkgClient],
  exports: [WhatsappLinkService],
})
export class WhatsappModule {}
