import { registerAs } from '@nestjs/config';

export const whatsappConfig = registerAs('whatsapp', () => ({
  enabled: process.env.WHATSAPP_ENABLED === 'true',
  writesEnabled: process.env.WHATSAPP_WRITES_ENABLED === 'true',
  waAkgBaseUrl: (process.env.WA_AKG_BASE_URL ?? '').trim().replace(/\/+$/, ''),
  waAkgApiKey: process.env.WA_AKG_API_KEY?.trim() ?? '',
  waAkgSessionId: process.env.WA_AKG_SESSION_ID?.trim() ?? '',
  waAkgWebhookSecret: process.env.WA_AKG_WEBHOOK_SECRET?.trim() ?? '',
  // Valor invalido (NaN) cairia em AbortSignal.timeout(NaN) e todo envio falharia: volta ao padrao.
  waAkgTimeoutMs: parseInt(process.env.WA_AKG_TIMEOUT_MS ?? '', 10) || 8000,
  contactNumber: process.env.WHATSAPP_CONTACT_NUMBER?.trim() ?? '',
}));
