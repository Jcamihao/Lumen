import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { REQUEST_ID_HEADER } from '../constants/request-trace.constants';
import { RequestWithContext } from '../interfaces/request-with-context.interface';

@Catch()
export class HttpExceptionLoggingFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionLoggingFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithContext>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = request.requestId ?? 'unknown';
    const userId = request.user?.sub ?? 'anonymous';
    const payload = this.normalizeExceptionPayload(exception, request);

    response.setHeader(REQUEST_ID_HEADER, requestId);

    const logLine =
      `request_failed requestId=${requestId} method=${request.method} ` +
      `path=${request.originalUrl ?? request.url} status=${status} userId=${userId}`;

    if (status >= 500) {
      this.logger.error(
        logLine,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(logLine);
    }

    response.status(status).json(payload);
  }

  private normalizeExceptionPayload(
    exception: unknown,
    request: RequestWithContext,
  ) {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const normalized =
        typeof response === 'string' ? { message: response } : response;

      return {
        statusCode: exception.getStatus(),
        timestamp: new Date().toISOString(),
        path: request.originalUrl ?? request.url,
        requestId: request.requestId,
        ...(typeof normalized === 'object' && normalized !== null
          ? normalized
          : { message: 'Erro inesperado.' }),
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
      requestId: request.requestId,
      message: 'Erro interno do servidor.',
    };
  }
}
