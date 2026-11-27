import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { readBootstrapSettings } from './bootstrap/bootstrap-settings';
import { BOOTSTRAP_CONTEXT, GLOBAL_PREFIX, NEST_LOG_LEVELS } from './bootstrap/bootstrap.constants';
import { configureApp } from './bootstrap/configure-app';

async function bootstrap() {
  const logger = new Logger(BOOTSTRAP_CONTEXT);
  const app = await NestFactory.create(AppModule, { logger: NEST_LOG_LEVELS });
  const settings = readBootstrapSettings(app.get(ConfigService));

  configureApp(app, settings);

  await app.listen(settings.port, settings.host);
  logger.log(`LUMEN API running at ${settings.appUrl}/${GLOBAL_PREFIX}`);
}

bootstrap();
