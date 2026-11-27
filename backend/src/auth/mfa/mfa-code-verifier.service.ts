import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { UserRecord } from "../session/session.types";
import { MfaService } from "../mfa.service";

/** So o que a verificacao do codigo precisa do usuario. */
export type MfaVerifiableUser = Pick<UserRecord, "id" | "mfaTotpSecretEncrypted" | "mfaRecoveryCodes">;

/** Confere um codigo MFA (TOTP ou de recuperacao) e grava que ele foi usado. */
@Injectable()
export class MfaCodeVerifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
  ) {}

  async verifyAndPersist(user: MfaVerifiableUser, code: string): Promise<void> {
    const secret = user.mfaTotpSecretEncrypted ? this.mfa.decryptSecret(user.mfaTotpSecretEncrypted) : null;
    const totpStep = secret ? this.mfa.matchTotpStep(secret, code) : null;

    if (totpStep !== null) {
      await this.claimTotpStep(user.id, totpStep);
      return;
    }
    await this.consumeRecoveryCode(user, code);
  }

  // Cada passo de 30s so vale uma vez (RFC 6238 §5.2). O UPDATE condicional e
  // atomico: duas requisicoes com o mesmo codigo nao passam as duas.
  private async claimTotpStep(userId: string, totpStep: number) {
    const claimed = await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ mfaLastTotpStep: null }, { mfaLastTotpStep: { lt: totpStep } }] },
      data: { mfaLastTotpStep: totpStep, mfaLastVerifiedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedException("Esse codigo ja foi usado. Aguarde o proximo codigo do autenticador.");
    }
  }

  private async consumeRecoveryCode(user: MfaVerifiableUser, code: string) {
    const recoveryCodes = this.mfa.parseRecoveryCodeRecords(user.mfaRecoveryCodes);
    const { matched, updatedRecords } = await this.mfa.consumeRecoveryCode(code, recoveryCodes);
    if (!matched) {
      throw new UnauthorizedException(
        "Codigo MFA invalido. Use um codigo do autenticador ou um codigo de recuperacao valido.",
      );
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaLastVerifiedAt: new Date(), mfaRecoveryCodes: updatedRecords },
    });
  }
}
