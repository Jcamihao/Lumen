export type AccountPrivacyFields = {
  privacyNoticeAcceptedAt: Date | null;
  aiAssistantEnabled: boolean;
  aiAssistantConsentAt: Date | null;
};

const AI_SHARED_DATA_CATEGORIES = [
  "primeiro nome",
  "pergunta do usuario com redacao de padroes sensiveis",
  "resumo de tarefas relevantes",
  "resumo de transacoes recentes",
  "resumo de metas, lembretes, insights e previsao",
];

export function buildExternalProcessing(account: AccountPrivacyFields) {
  const active = Boolean(
    account.aiAssistantEnabled &&
      account.aiAssistantConsentAt &&
      account.privacyNoticeAcceptedAt,
  );

  return {
    active,
    processor: active ? "SelahIA" : null,
    purpose: active
      ? "Responder perguntas do assistente de vida com contexto minimizado."
      : "Nenhum provedor externo de IA habilitado neste momento.",
    sharedDataCategories: active ? [...AI_SHARED_DATA_CATEGORIES] : [],
  };
}
