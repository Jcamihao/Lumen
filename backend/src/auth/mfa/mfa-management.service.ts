import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { UsersService } from "../../users/users.service";
import { MfaCodeDto } from "../dto/mfa-code.dto";
import { MfaService } from "../mfa.service";
import { MfaCodeVerifier } from "./mfa-code-verifier.service";
import { assertMfaIsConfigured, isMfaEnabled, MfaGate } from "./mfa-gate";

/** Ativar, confirmar, regenerar codigos de recuperacao e desativar o MFA da conta. */
@Injectable()
export class MfaManagementService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mfa: MfaService,
    private readonly gate: MfaGate,
    private readonly verifier: MfaCodeVerifier,
  ) {}

  async startSetup(userId: string) {
    this.gate.assertFeatureEnabled();
    const user = await this.users.findById(userId);
    if (isMfaEnabled(user)) {
      throw new BadRequestException("O MFA ja esta ativo para esta conta. Desative antes de configurar novamente.");
    }

    const secret = this.mfa.generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaPendingTotpSecretEncrypted: this.mfa.encryptSecret(secret) },
    });
    return {
      secret,
      otpauthUrl: this.mfa.buildOtpAuthUrl(user.email, secret),
      issuer: this.config.get<string>("auth.mfaIssuer") ?? "LUMEN",
      accountName: user.email,
    };
  }

  async confirmSetup(userId: string, dto: MfaCodeDto) {
    this.gate.assertFeatureEnabled();
    const user = await this.users.findById(userId);
    if (!user.mfaPendingTotpSecretEncrypted) {
      throw new BadRequestException("Nao ha configuracao de MFA pendente para confirmar.");
    }

    const secret = this.mfa.decryptSecret(user.mfaPendingTotpSecretEncrypted);
    const confirmedStep = this.mfa.matchTotpStep(secret, dto.code);
    if (confirmedStep === null) {
      throw new BadRequestException("Codigo MFA invalido. Confira o codigo do autenticador e tente novamente.");
    }

    const { plainCodes, hashedCodes } = await this.mfa.generateRecoveryCodes();
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabledAt: user.mfaEnabledAt ?? now,
        mfaLastVerifiedAt: now,
        mfaLastTotpStep: confirmedStep,
        mfaTotpSecretEncrypted: this.mfa.encryptSecret(secret),
        mfaPendingTotpSecretEncrypted: null,
        mfaRecoveryCodes: hashedCodes,
      },
    });
    return { success: true, recoveryCodes: plainCodes, user: await this.users.getMe(userId) };
  }

  async regenerateRecoveryCodes(userId: string, dto: MfaCodeDto) {
    this.gate.assertFeatureEnabled();
    const user = await this.users.findById(userId);
    assertMfaIsConfigured(user);

    await this.verifier.verifyAndPersist(user, dto.code);
    const { plainCodes, hashedCodes } = await this.mfa.generateRecoveryCodes();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaRecoveryCodes: hashedCodes } });
    return { success: true, recoveryCodes: plainCodes, user: await this.users.getMe(userId) };
  }

  async disable(userId: string, dto: MfaCodeDto) {
    this.gate.assertFeatureEnabled();
    const user = await this.users.findById(userId);
    assertMfaIsConfigured(user);
    await this.verifier.verifyAndPersist(user, dto.code);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabledAt: null,
        mfaLastVerifiedAt: null,
        mfaLastTotpStep: null,
        mfaTotpSecretEncrypted: null,
        mfaPendingTotpSecretEncrypted: null,
        mfaRecoveryCodes: null,
      },
    });
    return { success: true, user: await this.users.getMe(userId) };
  }
}
