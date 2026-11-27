import { Logger } from '@nestjs/common';
import { Response } from 'express';
import { RequestWithContext } from '../common/interfaces/request-with-context.interface';

const CLIENT_ERROR_STATUS = 400;
const SERVER_ERROR_STATUS = 500;

export function logRequestCompleted(
  logger: Logger,
  req: RequestWithContext,
  res: Response,
  requestId: string,
  startedAt: number,
): void {
  const durationMs = Date.now() - startedAt;
  const message = buildRequestLogMessage(req, res.statusCode, requestId, durationMs);
  writeByStatus(logger, res.statusCode, message);
}

function buildRequestLogMessage(
  req: RequestWithContext,
  statusCode: number,
  requestId: string,
  durationMs: number,
): string {
  const userId = req.user?.sub ?? 'anonymous';
  return (
    `request_completed requestId=${requestId} method=${req.method} ` +
    `path=${req.originalUrl ?? req.url} status=${statusCode} durationMs=${durationMs} userId=${userId}`
  );
}

function writeByStatus(logger: Logger, statusCode: number, message: string): void {
  if (statusCode >= SERVER_ERROR_STATUS) {
    logger.error(message);
  } else if (statusCode >= CLIENT_ERROR_STATUS) {
    logger.warn(message);
  } else {
    logger.log(message);
  }
}
