import * as bcrypt from "bcryptjs";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const now = new Date();
  const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const configValues: Record<string, string> = {
    "auth.refreshSecret": "refresh-secret",
    "auth.accessSecret": "access-secret",
    "auth.accessExpiresIn": "15m",
    "auth.refreshExpiresIn": "7d",
  };

  const buildConfigService = () =>
    ({
      get: jest.fn((key: string) => configValues[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = configValues[key];
        if (!value) {
          throw new Error(`missing config ${key}`);
        }
        return value;
      }),
    }) as any;

  const buildUsersService = (overrides: Partial<{ id: string }> = {}) =>
    ({
      findById: jest.fn().mockResolvedValue({
        id: overrides.id ?? "user-1",
        email: "marina@exemplo.com",
        role: "USER",
      }),
      sanitizeUser: jest.fn((user: any) => ({ ...user, passwordHash: undefined })),
    }) as any;

  const buildJwtService = (payload: any) =>
    ({
      verifyAsync: jest.fn().mockResolvedValue(payload),
      signAsync: jest
        .fn()
        .mockResolvedValueOnce("new-access-token")
        .mockResolvedValueOnce("new-refresh-token"),
    }) as any;

  const buildPrismaService = (session: any) =>
    ({
      authSession: {
        findFirst: jest.fn().mockResolvedValue(session),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
    }) as any;

  const buildService = (options: {
    session: any;
    jwtPayload?: any;
    jwtRejects?: boolean;
  }) => {
    const jwtService = options.jwtRejects
      ? ({
          verifyAsync: jest.fn().mockRejectedValue(new Error("bad token")),
          signAsync: jest.fn(),
        } as any)
      : buildJwtService(
          options.jwtPayload ?? {
            sub: "user-1",
            email: "marina@exemplo.com",
            role: "USER",
            sessionId: "session-1",
          },
        );
    const prisma = buildPrismaService(options.session);

    const service = new AuthService(
      buildUsersService(),
      jwtService,
      buildConfigService(),
      {} as any,
      prisma,
      {} as any,
    );

    return { service, jwtService, prisma };
  };

  describe("refresh", () => {
    it("rotates tokens and keeps the same session id on the happy path", async () => {
      const validRefreshToken = "valid-refresh-token";
      const session = {
        id: "session-1",
        userId: "user-1",
        refreshTokenHash: await bcrypt.hash(validRefreshToken, 10),
        revokedAt: null,
        expiresAt: futureDate,
      };
      const { service, jwtService, prisma } = buildService({ session });

      const result = await service.refresh({ refreshToken: validRefreshToken });

      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "session-1",
            userId: "user-1",
            revokedAt: null,
          }),
          data: expect.objectContaining({ revokeReason: null }),
        }),
      );
    });

    it("rejects an invalid or expired JWT without touching the session", async () => {
      const { service, prisma } = buildService({
        session: null,
        jwtRejects: true,
      });

      await expect(
        service.refresh({ refreshToken: "garbage" }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.authSession.findFirst).not.toHaveBeenCalled();
    });

    it("revokes the session and rejects when the refresh token was already rotated (reuse detection)", async () => {
      const session = {
        id: "session-1",
        userId: "user-1",
        refreshTokenHash: await bcrypt.hash("a-different-already-used-token", 10),
        revokedAt: null,
        expiresAt: futureDate,
      };
      const { service, prisma } = buildService({ session });

      await expect(
        service.refresh({ refreshToken: "stolen-or-reused-token" }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "session-1" }),
          data: expect.objectContaining({
            revokeReason: "refresh_token_reuse_detected",
          }),
        }),
      );
    });

    it("rejects a revoked session before comparing the token", async () => {
      const session = {
        id: "session-1",
        userId: "user-1",
        refreshTokenHash: await bcrypt.hash("whatever", 10),
        revokedAt: now,
        expiresAt: futureDate,
      };
      const { service, prisma } = buildService({ session });

      await expect(
        service.refresh({ refreshToken: "whatever" }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
    });

    it("rejects an expired session before comparing the token", async () => {
      const session = {
        id: "session-1",
        userId: "user-1",
        refreshTokenHash: await bcrypt.hash("whatever", 10),
        revokedAt: null,
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      };
      const { service, prisma } = buildService({ session });

      await expect(
        service.refresh({ refreshToken: "whatever" }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("revokes only the session that matches both sessionId and userId", async () => {
      const { service, prisma } = buildService({ session: null });

      const result = await service.logout("user-1", "session-1");

      expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "session-1",
            userId: "user-1",
            revokedAt: null,
          }),
          data: expect.objectContaining({ revokeReason: "logout" }),
        }),
      );
      expect(result.success).toBe(true);
    });
  });
});
