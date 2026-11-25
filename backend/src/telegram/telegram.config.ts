import { registerAs } from '@nestjs/config';

export const telegramConfig = registerAs('telegram', () => ({
  enabled: process.env.TELEGRAM_ENABLED === 'true',
  writesEnabled: process.env.TELEGRAM_WRITES_ENABLED === 'true',
  botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '',
  // Sobrevive configurável para os testes (Bot API falsa) e proxies. O padrão é a Bot API oficial.
  baseUrl: (process.env.TELEGRAM_BASE_URL?.trim() || 'https://api.telegram.org').replace(/\/+$/, ''),
  // Valor invalido (NaN) cairia em AbortSignal.timeout(NaN) e todo envio falharia: volta ao padrao.
  timeoutMs: parseInt(process.env.TELEGRAM_TIMEOUT_MS ?? '', 10) || 8000,
  // Segundo o Telegram, o timeout do long polling deve ficar abaixo do timeout HTTP da request.
  pollTimeoutS: Math.min(Math.max(parseInt(process.env.TELEGRAM_POLL_TIMEOUT_S ?? '', 10) || 25, 0), 50),
}));
