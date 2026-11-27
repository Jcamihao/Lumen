import { ConfigService } from '@nestjs/config';
import { DEFAULT_HOST, DEFAULT_PORT } from './bootstrap.constants';

export type BootstrapSettings = {
  port: number;
  host: string;
  appUrl: string;
  corsAllowedOrigins: string[];
  swaggerEnabled: boolean;
};

export function readBootstrapSettings(configService: ConfigService): BootstrapSettings {
  const port = configService.get<number>('app.port', DEFAULT_PORT);
  return {
    port,
    host: configService.get<string>('app.host', DEFAULT_HOST),
    appUrl: configService.get<string>('app.appUrl') ?? `http://localhost:${port}`,
    corsAllowedOrigins: configService.get<string[]>('app.corsAllowedOrigins') ?? [],
    swaggerEnabled: configService.get<boolean>('app.swaggerEnabled') ?? false,
  };
}
