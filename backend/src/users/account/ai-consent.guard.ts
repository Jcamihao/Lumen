import { BadRequestException } from "@nestjs/common";
import { UpdateUserDto } from "../dto/update-user.dto";
import { CurrentConsent } from "./consent-update.data";

export function assertPrivacyAcceptedForAi(dto: UpdateUserDto, current: CurrentConsent) {
  const enablingAiWithoutNotice =
    dto.aiAssistantEnabled && !current.privacyNoticeAcceptedAt && !dto.privacyNoticeAccepted;
  if (enablingAiWithoutNotice) {
    throw new BadRequestException(
      "Aceite o aviso de privacidade antes de ativar o assistente com IA externa.",
    );
  }
}
