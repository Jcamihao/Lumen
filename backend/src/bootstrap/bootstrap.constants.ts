import { LogLevel } from '@nestjs/common';

export const BOOTSTRAP_CONTEXT = 'Bootstrap';
export const NEST_LOG_LEVELS: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
export const GLOBAL_PREFIX = 'api/v1';
export const TRUST_PROXY_HOPS = 1;
export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = '0.0.0.0';
export const BODY_LIMIT = '5mb';
export const WHATSAPP_WEBHOOK_PATH = `/${GLOBAL_PREFIX}/whatsapp/webhook`;
