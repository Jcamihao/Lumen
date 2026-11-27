import { INestApplication, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { REQUEST_ID_HEADER } from '../common/constants/request-trace.constants';
import { RequestWithContext } from '../common/interfaces/request-with-context.interface';
import { BOOTSTRAP_CONTEXT } from './bootstrap.constants';
import { logRequestCompleted } from './log-request-completed';

export function configureRequestTracing(app: INestApplication): void {
  const logger = new Logger(BOOTSTRAP_CONTEXT);
  app.use((req: RequestWithContext, res, next) => {
    const requestId = resolveRequestId(req.header(REQUEST_ID_HEADER));
    const startedAt = Date.now();

    req.requestId = requestId;
    req.startedAt = startedAt;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.on('finish', () => logRequestCompleted(logger, req, res, requestId, startedAt));

    next();
  });
}

function resolveRequestId(requestIdHeader: string | undefined): string {
  return requestIdHeader?.trim() || randomUUID();
}
