import { PrismaService } from "../../prisma/prisma.service";
import { AssistantPrivacySettings, SelahAttemptReason } from '../assistant.types';

export async function loadPrivacySettings(prisma: PrismaService, userId: string,
): Promise<AssistantPrivacySettings> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      privacyNoticeAcceptedAt: true,
      aiAssistantEnabled: true,
      aiAssistantConsentAt: true,
    },
  });

  return {
    privacyNoticeAcceptedAt: user.privacyNoticeAcceptedAt,
    aiAssistantEnabled: user.aiAssistantEnabled,
    aiAssistantConsentAt: user.aiAssistantConsentAt,
  };
}

export function resolveLocalDisclaimer(reason: SelahAttemptReason) {
  if (reason === "privacy_notice_missing") {
    return "Revise e aceite o aviso de privacidade nas configuracoes para liberar o uso de IA externa.";
  }

  if (reason === "ai_consent_missing") {
    return "O uso do SelahIA esta desligado nas configuracoes de privacidade. Resposta gerada pelo modo local do LUMEN.";
  }

  if (reason === "integration_disabled" || reason === "selah_unavailable") {
    return "SelahIA indisponivel no momento. Resposta gerada pelo modo local do LUMEN.";
  }

  return null;
}
