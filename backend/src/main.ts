import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import compression = require('compression');
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { REQUEST_ID_HEADER } from './common/constants/request-trace.constants';
import { HttpExceptionLoggingFilter } from './common/filters/http-exception-logging.filter';
import { RequestWithContext } from './common/interfaces/request-with-context.interface';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const configService = app.get(ConfigService);
  const prismaService = app.get(PrismaService);
  const port = configService.get<number>('app.port', 3000);
  const appUrl =
    configService.get<string>('app.appUrl') ?? `http://localhost:${port}`;

  await prismaService.enableShutdownHooks(app);

  app.setGlobalPrefix('api/v1');
  app.use((req: RequestWithContext, res, next) => {
    const requestIdHeader = req.header(REQUEST_ID_HEADER);
    const requestId = requestIdHeader?.trim() || randomUUID();
    const startedAt = Date.now();

    req.requestId = requestId;
    req.startedAt = startedAt;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const userId = req.user?.sub ?? 'anonymous';
      const statusCode = res.statusCode;
      const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'log';
      const logMessage =
        `request_completed requestId=${requestId} method=${req.method} ` +
        `path=${req.originalUrl ?? req.url} status=${statusCode} durationMs=${durationMs} userId=${userId}`;

      if (level === 'error') {
        logger.error(logMessage);
        return;
      }

      if (level === 'warn') {
        logger.warn(logMessage);
        return;
      }

      logger.log(logMessage);
    });

    next();
  });

  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));
  app.use(helmet());
  app.use(compression());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new HttpExceptionLoggingFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('LUMEN API')
    .setDescription(
      'API do SaaS LUMEN para gestao de vida, conectando tarefas, financas, metas e rotina.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(port);
  logger.log(`LUMEN API running at ${appUrl}/api/v1`);
}

bootstrap();
