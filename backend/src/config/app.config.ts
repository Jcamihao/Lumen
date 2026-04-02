import { registerAs } from '@nestjs/config';

const DEFAULT_CORS_ALLOWED_ORIGINS = [
  'http://localhost:4200',
  'http://127.0.0.1:4200',
  'http://localhost:8100',
  'http://127.0.0.1:8100',
  'http://localhost',
  'http://127.0.0.1',
  'capacitor://localhost',
];

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseCorsAllowedOrigins() {
  const rawOrigins = process.env.APP_CORS_ALLOWED_ORIGINS;

  if (!rawOrigins) {
    return DEFAULT_CORS_ALLOWED_ORIGINS;
  }

  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  corsAllowedOrigins: parseCorsAllowedOrigins(),
  swaggerEnabled: parseBoolean(
    process.env.APP_SWAGGER_ENABLED,
    (process.env.NODE_ENV ?? 'development') !== 'production',
  ),
}));
