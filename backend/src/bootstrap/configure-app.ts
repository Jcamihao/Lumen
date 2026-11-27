import { INestApplication } from '@nestjs/common';
import { HttpExceptionLoggingFilter } from '../common/filters/http-exception-logging.filter';
import { BootstrapSettings } from './bootstrap-settings';
import { GLOBAL_PREFIX, TRUST_PROXY_HOPS } from './bootstrap.constants';
import { configureBodyParsers } from './configure-body-parsers';
import { configureCors } from './configure-cors';
import { configureHelmetAndCompression } from './configure-helmet-and-compression';
import { configureRequestTracing } from './configure-request-tracing';
import { configureSwagger } from './configure-swagger';
import { configureValidation } from './configure-validation';

// A ordem dos middlewares importa: cada chamada define a cadeia da proxima.
export function configureApp(app: INestApplication, settings: BootstrapSettings): void {
  app.getHttpAdapter().getInstance().set('trust proxy', TRUST_PROXY_HOPS);
  app.enableShutdownHooks();
  app.setGlobalPrefix(GLOBAL_PREFIX);
  configureRequestTracing(app);
  configureCors(app, settings.corsAllowedOrigins);
  configureBodyParsers(app);
  configureHelmetAndCompression(app);
  configureValidation(app);
  app.useGlobalFilters(new HttpExceptionLoggingFilter());
  if (settings.swaggerEnabled) {
    configureSwagger(app);
  }
}
