import { randomUUID } from "crypto";
import * as bcrypt from "bcryptjs";
import { BadRequestException } from "@nestjs/common";
import { AuthService } from "./auth.service";

describe("AuthService — email flows (reset de senha e confirmacao de email)", () => {
  type Challenge = {
    id: string;
    userId: string;
    type: string;
    token: string | null;
    expiresAt: Date;
    completedAt: Date | null;
  };

  const buildHarness = (options: { knownEmail?: boolean; verifiedAt?: Date | null } = {}) => {
    const challenges: Challenge[] = [];
    const user = {
      id: "user-1",
      email: "marina@exemplo.com",
      name: "Marina Costa",
      emailVerifiedAt: options.verifiedAt ?? null,
    };

    const prisma = {
      authChallenge: {
        deleteMany: jest.fn(async ({ where }: any) => {
          const before = challenges.length;
          for (let i = challenges.length - 1; i >= 0; i -= 1) {
            const c = challenges[i];
            if (c.userId === where.userId && c.type === where.type && c.completedAt === null) {
              challenges.splice(i, 1);
            }
          }
          return { count: before - challenges.length };
        }),
        create: jest.fn(async ({ data }: any) => {
          const challenge: Challenge = { id: randomUUID(), completedAt: null, ...data };
          challenges.push(challenge);
          return challenge;
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          challenges.find((c) => c.id === where.id) ?? null,
        ),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const target = challenges.find(
            (c) => c.id === where.id && c.completedAt === where.completedAt,
          );
          if (!target) return { count: 0 };
          Object.assign(target, data);
          return { count: 1 };
        }),
      },
      authSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const usersService = {
      findByEmail: jest.fn(async (email: string) =>
        options.knownEmail === false || email !== user.email ? null : user,
      ),
      findById: jest.fn(async () => user),
      updatePassword: jest.fn().mockResolvedValue(undefined),
      markEmailVerified: jest.fn().mockResolvedValue(undefined),
    };
    const mailService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
      sendPasswordChangedEmail: jest.fn().mockResolvedValue({}),
      sendEmailVerificationEmail: jest.fn().mockResolvedValue({}),
      sendWelcomeEmail: jest.fn().mockResolvedValue({}),
    };
    const configValues: Record<string, unknown> = {
      "app.frontendUrl": "https://financelumen.tech",
      "auth.passwordResetTtlMinutes": 60,
      "auth.emailVerificationTtlHours": 48,
    };
    const configService = {
      get: jest.fn((key: string, fallback?: unknown) => configValues[key] ?? fallback),
      getOrThrow: jest.fn((key: string) => configValues[key]),
    };

    const service = new AuthService(
      usersService as any,
      {} as any,
      configService as any,
      mailService as any,
      prisma as any,
      {} as any,
    );

    const linkFrom = (url: string) => {
      const parsed = new URL(url);
      return {
        id: parsed.searchParams.get("id") as string,
        token: parsed.searchParams.get("token") as string,
      };
    };

    return { service, prisma, usersService, mailService, challenges, user, linkFrom };
  };

  describe("forgotPassword", () => {
    it("answers the same way for unknown emails and sends nothing", async () => {
      const known = buildHarness();
      const unknown = buildHarness({ knownEmail: false });

      const knownResult = await known.service.forgotPassword({ email: "Marina@Exemplo.com " });
      const unknownResult = await unknown.service.forgotPassword({ email: "ninguem@exemplo.com" });

      expect(unknownResult).toEqual(knownResult);
      expect(unknown.prisma.authChallenge.create).not.toHaveBeenCalled();
      expect(unknown.mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it("creates one pending challenge and emails a frontend reset link", async () => {
      const { service, mailService, challenges, prisma, linkFrom } = buildHarness();

      await service.forgotPassword({ email: "marina@exemplo.com" });
      await service.forgotPassword({ email: "marina@exemplo.com" });

      // O segundo pedido invalida o link anterior: so resta um pendente.
      expect(prisma.authChallenge.deleteMany).toHaveBeenCalledTimes(2);
      expect(challenges).toHaveLength(1);
      expect(challenges[0].type).toBe("PASSWORD_RESET");
      // O segredo nunca vai pro banco em texto puro.
      const lastMail = mailService.sendPasswordResetEmail.mock.calls[1][0];
      expect(lastMail.resetUrl).toMatch(
        /^https:\/\/financelumen\.tech\/auth\/reset-password\?id=/,
      );
      expect(challenges[0].token).not.toContain(linkFrom(lastMail.resetUrl).token);
      expect(lastMail.expiresInMinutes).toBe(60);
    });
  });

  describe("resetPassword", () => {
    const requestLink = async (harness: ReturnType<typeof buildHarness>) => {
      await harness.service.forgotPassword({ email: "marina@exemplo.com" });
      const { resetUrl } = harness.mailService.sendPasswordResetEmail.mock.calls[0][0];
      return harness.linkFrom(resetUrl);
    };

    it("stores a bcrypt hash of the new password, consumes the link and revokes every session", async () => {
      const harness = buildHarness();
      const link = await requestLink(harness);

      const result = await harness.service.resetPassword({ ...link, password: "NovaSenha123!" });

      expect(result).toEqual({ success: true });
      const [userId, storedHash] = harness.usersService.updatePassword.mock.calls[0];
      expect(userId).toBe("user-1");
      expect(storedHash).not.toBe("NovaSenha123!");
      expect(await bcrypt.compare("NovaSenha123!", storedHash)).toBe(true);
      expect(harness.challenges[0].completedAt).toBeInstanceOf(Date);
      expect(harness.prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", revokedAt: null },
        data: expect.objectContaining({ revokeReason: "password_reset" }),
      });
      expect(harness.usersService.markEmailVerified).toHaveBeenCalledWith("user-1");
      expect(harness.mailService.sendPasswordChangedEmail).toHaveBeenCalled();
    });

    it("rejects reusing the same link", async () => {
      const harness = buildHarness();
      const link = await requestLink(harness);

      await harness.service.resetPassword({ ...link, password: "NovaSenha123!" });

      await expect(
        harness.service.resetPassword({ ...link, password: "OutraSenha123!" }),
      ).rejects.toThrow(BadRequestException);
      expect(harness.usersService.updatePassword).toHaveBeenCalledTimes(1);
    });

    it("rejects a wrong token without consuming the real link", async () => {
      const harness = buildHarness();
      const link = await requestLink(harness);

      await expect(
        harness.service.resetPassword({
          id: link.id,
          token: "x".repeat(43),
          password: "NovaSenha123!",
        }),
      ).rejects.toThrow(BadRequestException);

      expect(harness.usersService.updatePassword).not.toHaveBeenCalled();
      expect(harness.challenges[0].completedAt).toBeNull();
    });

    it("rejects an expired link", async () => {
      const harness = buildHarness();
      const link = await requestLink(harness);
      harness.challenges[0].expiresAt = new Date(Date.now() - 1000);

      await expect(
        harness.service.resetPassword({ ...link, password: "NovaSenha123!" }),
      ).rejects.toThrow(BadRequestException);
      expect(harness.usersService.updatePassword).not.toHaveBeenCalled();
    });

    it("rejects an email-verification link used as a reset link", async () => {
      const harness = buildHarness();
      await harness.service.resendEmailVerification("user-1");
      const { verifyUrl } = harness.mailService.sendEmailVerificationEmail.mock.calls[0][0];

      await expect(
        harness.service.resetPassword({
          ...harness.linkFrom(verifyUrl),
          password: "NovaSenha123!",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(harness.usersService.updatePassword).not.toHaveBeenCalled();
    });
  });

  describe("email verification", () => {
    it("marks the email verified when the link is valid, once", async () => {
      const harness = buildHarness();
      await harness.service.resendEmailVerification("user-1");
      const { verifyUrl } = harness.mailService.sendEmailVerificationEmail.mock.calls[0][0];
      const link = harness.linkFrom(verifyUrl);

      expect(verifyUrl).toMatch(/^https:\/\/financelumen\.tech\/auth\/verify-email\?id=/);
      await expect(harness.service.verifyEmail(link)).resolves.toEqual({ success: true });
      expect(harness.usersService.markEmailVerified).toHaveBeenCalledWith("user-1");
      await expect(harness.service.verifyEmail(link)).rejects.toThrow(BadRequestException);
    });

    it("does not resend when the email is already verified", async () => {
      const harness = buildHarness({ verifiedAt: new Date() });

      const result = await harness.service.resendEmailVerification("user-1");

      expect(result).toEqual({ success: true, alreadyVerified: true });
      expect(harness.mailService.sendEmailVerificationEmail).not.toHaveBeenCalled();
      expect(harness.prisma.authChallenge.create).not.toHaveBeenCalled();
    });
  });
});
