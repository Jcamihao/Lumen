// Contrato de GET /whatsapp/status e POST /whatsapp/link-code (backend, item 5a).
// Manter em sincronia manualmente: o front não importa do backend.

/** Resposta de GET /whatsapp/status. */
export interface WhatsappStatus {
  /** false = recurso desligado no servidor. */
  enabled: boolean;
  linked: boolean;
  /** ISO. Presente só quando linked. */
  linkedAt?: string;
  /** Já mascarado pelo servidor, ex.: "+55 11 *****-1234". */
  maskedNumber?: string;
  /** Número do Lumen no WhatsApp. Só existe se enabled e se o servidor tem o número configurado. */
  contactNumber?: string;
}

/** Resposta de POST /whatsapp/link-code (201). */
export interface WhatsappLinkCode {
  /** 8 caracteres, ex.: "K7M2QX9P". Segredo de curta duração: nunca persistir. */
  code: string;
  /** ISO. Validade de 10 minutos. */
  expiresAt: string;
}
