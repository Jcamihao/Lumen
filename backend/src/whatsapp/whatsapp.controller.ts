import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { WhatsappAdapterService } from './whatsapp-adapter.service';
import { WhatsappLinkService } from './whatsapp-link.service';
import { verifyWebhookSignature } from './webhook-signature';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly config: ConfigService,
    private readonly links: WhatsappLinkService,
    private readonly adapter: WhatsappAdapterService,
  ) {}

  @Post('link-code')
  @ApiOperation({ summary: 'Gera codigo de vinculo do WhatsApp (uso unico, 10 min)' })
  linkCode(@CurrentUser() user: AuthenticatedUser) {
    return this.links.createCode(user.sub);
  }

  @Get('status')
  @ApiOperation({ summary: 'Estado do vinculo do WhatsApp da conta logada' })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.links.getStatus(user.sub);
  }

  @Delete('link')
  @HttpCode(204)
  @ApiOperation({ summary: 'Desvincula o WhatsApp da conta logada (idempotente)' })
  async unlink(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.links.unlinkByUserId(user.sub);
  }

  /**
   * Webhook do WA-AKG. Autenticado so pela assinatura sobre o corpo bruto.
   * Responde 200 antes do envio: o WA-AKG tem limite de 10 s e nao reenvia.
   */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recebe eventos do WA-AKG (mensagens recebidas, assinadas)' })
  webhook(
    @Req() req: RawBodyRequest,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    if (!this.config.get<boolean>('whatsapp.enabled')) {
      throw new HttpException({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: 'WHATSAPP_DISABLED', message: 'O canal WhatsApp está desligado.' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const secret = this.config.get<string>('whatsapp.waAkgWebhookSecret') ?? '';
    if (!req.rawBody || !verifyWebhookSignature(req.rawBody, signature, secret)) {
      throw new UnauthorizedException();
    }
    void this.adapter.handleInbound(body);
    return { ok: true };
  }
}
