import { Module } from "@nestjs/common";
import { MailService } from "./mail.service";
import { ResendSettings } from "./resend/resend.settings";
import { ResendTransport } from "./resend/resend.transport";

@Module({
  providers: [MailService, ResendTransport, ResendSettings],
  exports: [MailService],
})
export class MailModule {}
