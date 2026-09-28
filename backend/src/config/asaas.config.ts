import { registerAs } from '@nestjs/config';

export const asaasConfig = registerAs('asaas', () => ({
  apiKey: process.env.ASAAS_API_KEY?.trim() ?? '',
  baseUrl: (
    process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3'
  ).replace(/\/+$/, ''),
  webhookToken: process.env.ASAAS_WEBHOOK_TOKEN?.trim() ?? '',
  timeoutMs: parseInt(process.env.ASAAS_TIMEOUT_MS ?? '10000', 10),
}));
