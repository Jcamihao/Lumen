// Contrato de GET /telegram/status e POST /telegram/link-code (backend, item 10a).
// Manter em sincronia manualmente: o front não importa do backend.

/** Resposta de GET /telegram/status. */
export interface TelegramStatus {
  /** false = recurso desligado no servidor. */
  enabled: boolean;
  linked: boolean;
  /** ISO. Presente só quando linked. */
  linkedAt?: string;
  /** Chat já mascarado pelo servidor, ex.: "98••••••10". O id inteiro nunca chega aqui. */
  maskedChatId?: string;
  /** @ do bot (ex.: "lumen_bot"). Só existe se enabled e se o bot respondeu ao backend. */
  botUsername?: string;
}

/** Resposta de POST /telegram/link-code (201). */
export interface TelegramLinkCode {
  /** 8 caracteres, ex.: "K7M2QX9P". Segredo de curta duração: nunca persistir. */
  code: string;
  /** ISO. Validade de 10 minutos. */
  expiresAt: string;
}
