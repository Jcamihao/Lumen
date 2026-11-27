import { INestApplication } from '@nestjs/common';
import compression = require('compression');
import helmet from 'helmet';

export function configureHelmetAndCompression(app: INestApplication): void {
  app.use(helmet());
  app.use(compression());
}
