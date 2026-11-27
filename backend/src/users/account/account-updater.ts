import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { UpdateUserDto } from "../dto/update-user.dto";
import { CurrentConsent } from "./consent-update.data";
import { assertPrivacyAcceptedForAi } from "./ai-consent.guard";
import { buildUserUpdateData } from "./update-user.data";

export class AccountUpdater {
  constructor(private readonly prisma: PrismaService) {}

  async updateMe(userId: string, dto: UpdateUserDto) {
    const current = await this.loadConsent(userId);
    assertPrivacyAcceptedForAi(dto, current);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: buildUserUpdateData(dto, current, now),
      });
      // 9c-2: PATCH /users nao toca mais no ciclo. Fechamento/vencimento/escopo se
      // editam pelo cartao (PUT /credit-cards/:id e /credit-cycle/settings).
    });
  }

  async updatePassword(userId: string, passwordHash: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async markEmailVerified(userId: string) {
    await this.prisma.user.updateMany({
      where: { id: userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async updateLastLogin(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  private async loadConsent(userId: string): Promise<CurrentConsent> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        privacyNoticeAcceptedAt: true,
        aiAssistantConsentAt: true,
      },
    });
    if (!current) {
      throw new NotFoundException("Usuario nao encontrado.");
    }
    return current;
  }
}
