import { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { RequestWithContext } from '../common/interfaces/request-with-context.interface';
import { BODY_LIMIT, WHATSAPP_WEBHOOK_PATH } from './bootstrap.constants';

export function configureBodyParsers(app: INestApplication): void {
  // Corpo bruto so para o webhook do WhatsApp (a assinatura exige os bytes originais).
  app.use(
    json({
      limit: BODY_LIMIT,
      verify: (req: RequestWithContext & { rawBody?: Buffer }, _res, buf) => {
        if ((req.originalUrl ?? req.url ?? '').startsWith(WHATSAPP_WEBHOOK_PATH)) {
          req.rawBody = buf;
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: BODY_LIMIT }));
}
