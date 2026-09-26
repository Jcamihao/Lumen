import * as bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { MfaService } from "./mfa.service";

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

  describe("refresh: rotacao real (sha256 + janela de tolerancia)", () => {
    // JWTs do mesmo usuario compartilham os primeiros 72 bytes (cabecalho + inicio do
    // payload): e onde o bcrypt parava de ler e nao distinguia um token do outro.
    const prefix = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJzZXNzaW9uSWQiOiJzLTEi";
    const tokenA = `${prefix}.antigo-A`;
    const tokenB = `${prefix}.vigente-B`;
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    const baseSession = (over: Record<string, unknown> = {}) => ({
      id: "session-1",
      userId: "user-1",
      refreshTokenHash: sha(tokenB),
      recentRefreshTokenHashes: [{ hash: sha(tokenA), retiredAt: Date.now() - 120_000 }],
      revokedAt: null,
      expiresAt: futureDate,
      ...over,
    });

    it("premissa do bug: bcrypt aceitava o token antigo no lugar do vigente", () => {
      expect(bcrypt.compareSync(tokenA, bcrypt.hashSync(tokenB, 4))).toBe(true);
    });

    it("token vigente: rotaciona com troca atomica e guarda o anterior", async () => {
      const { service, prisma } = buildService({ session: baseSession(), jwtPayload: undefined });

      await service.refresh({ refreshToken: tokenB });

      const call = prisma.authSession.updateMany.mock.calls[0][0];
      expect(call.where.refreshTokenHash).toBe(sha(tokenB));
      expect(call.data.refreshTokenHash).toBe(sha("new-refresh-token"));
      // A (aposentado ha 120s, fora da janela) some; B (recem-substituido) entra na lista.
      expect(call.data.recentRefreshTokenHashes).toEqual([{ hash: sha(tokenB), retiredAt: expect.any(Number) }]);
    });

    it("token antigo depois da janela: recusa e revoga a sessao (com bcrypt passava)", async () => {
      const { service, prisma } = buildService({ session: baseSession() });

      await expect(service.refresh({ refreshToken: tokenA })).rejects.toThrow(UnauthorizedException);
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ revokeReason: "refresh_token_reuse_detected" }),
        }),
      );
    });

    it("token antigo DENTRO da janela (abas juntas, retry): aceita e rotaciona de novo", async () => {
      const { service, prisma } = buildService({
        session: baseSession({ recentRefreshTokenHashes: [{ hash: sha(tokenA), retiredAt: Date.now() - 5_000 }] }),
      });

      const result = await service.refresh({ refreshToken: tokenA });

      expect(result.refreshToken).toBe("new-refresh-token");
      // Nenhum token emitido na janela e invalidado: A continua na lista e B entra junto.
      expect(prisma.authSession.updateMany.mock.calls[0][0].data.recentRefreshTokenHashes.map((e: any) => e.hash)).toEqual([
        sha(tokenA),
        sha(tokenB),
      ]);
    });

    it("token que nao e nem o vigente nem o anterior: revoga mesmo dentro da janela", async () => {
      const { service, prisma } = buildService({
        session: baseSession({ recentRefreshTokenHashes: [{ hash: sha(tokenA), retiredAt: Date.now() - 1_000 }] }),
      });

      await expect(service.refresh({ refreshToken: `${prefix}.roubado-C` })).rejects.toThrow(UnauthorizedException);
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ revokeReason: "refresh_token_reuse_detected" }),
        }),
      );
    });

    it("sessao antiga (hash bcrypt): ainda entra e ja sai regravada em sha256", async () => {
      const legacyHash = await bcrypt.hash(tokenB, 4);
      const { service, prisma } = buildService({
        session: baseSession({ refreshTokenHash: legacyHash, recentRefreshTokenHashes: null }),
      });

      await service.refresh({ refreshToken: tokenB });

      const data = prisma.authSession.updateMany.mock.calls[0][0].data;
      expect(data.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data.recentRefreshTokenHashes).toEqual([{ hash: legacyHash, retiredAt: expect.any(Number) }]);
    });

    it("duas renovacoes simultaneas: quem perde a troca atomica refaz a leitura e passa pela janela", async () => {
      let signed = 0;
      const jwtService = {
        verifyAsync: jest.fn().mockResolvedValue({ sub: "user-1", email: "marina@exemplo.com", role: "USER", sessionId: "session-1" }),
        signAsync: jest.fn().mockImplementation(async () => `token-${(signed += 1)}`),
      } as any;
      const prisma = {
        authSession: {
          // 1a leitura (vigente=B) -> conflito -> 'ainda ativa' -> 2a leitura (outra aba ja rotacionou B->C)
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(baseSession({ recentRefreshTokenHashes: [] }))
            .mockResolvedValueOnce({ id: "session-1" })
            .mockResolvedValueOnce(
              baseSession({ refreshTokenHash: sha("C"), recentRefreshTokenHashes: [{ hash: sha(tokenB), retiredAt: Date.now() }] }),
            ),
          updateMany: jest.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 }),
          create: jest.fn(),
        },
      } as any;
      const service = new AuthService(buildUsersService(), jwtService, buildConfigService(), {} as any, prisma, {} as any);

      const result = await service.refresh({ refreshToken: tokenB });

      expect(result.accessToken).toBeDefined();
      expect(prisma.authSession.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.authSession.updateMany.mock.calls[1][0].where.refreshTokenHash).toBe(sha("C"));
    });
  });

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

  describe("login (nao revela por tempo quais emails tem conta)", () => {
    const buildLoginService = (foundUser: any) =>
      new AuthService(
        { findByEmail: jest.fn().mockResolvedValue(foundUser) } as any,
        {} as any,
        buildConfigService(),
        {} as any,
        buildPrismaService(null),
        {} as any,
      );

    afterEach(() => jest.restoreAllMocks());

    it("email inexistente: ainda roda um bcrypt.compare (contra hash descartavel) e responde 401 generico", async () => {
      const compareSpy = jest.spyOn(bcrypt as any, "compare");
      const service = buildLoginService(null);

      await expect(
        service.login({ email: "ninguem@exemplo.com", password: "qualquer-senha" } as any),
      ).rejects.toThrow("Credenciais invalidas.");

      expect(compareSpy).toHaveBeenCalledTimes(1);
      expect(compareSpy.mock.calls[0][0]).toBe("qualquer-senha");
      expect(String(compareSpy.mock.calls[0][1])).toMatch(/^\$2[aby]\$10\$/);
    });

    it("email existente com senha errada: mesma mensagem, um unico compare", async () => {
      const compareSpy = jest.spyOn(bcrypt as any, "compare");
      const passwordHash = await bcrypt.hash("senha-certa", 10);
      compareSpy.mockClear();
      const service = buildLoginService({ id: "user-1", email: "marina@exemplo.com", passwordHash });

      await expect(
        service.login({ email: "marina@exemplo.com", password: "senha-errada" } as any),
      ).rejects.toThrow("Credenciais invalidas.");

      expect(compareSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("MFA: cada codigo TOTP so vale uma vez", () => {
    const mfa = new MfaService({
      get: jest.fn(),
      getOrThrow: jest.fn(() => "test-mfa-encryption-secret"),
    } as any);
    const secret = mfa.generateTotpSecret();
    const step = Math.floor(Date.now() / 30_000);
    const codeFor = (offset: number) => (mfa as any).generateTotpCode(secret, step + offset);
    const user = () => ({
      id: "user-1",
      mfaEnabledAt: new Date(),
      mfaTotpSecretEncrypted: mfa.encryptSecret(secret),
      mfaRecoveryCodes: null,
    });
    const build = (claimedCount: number) => {
      const prisma = { user: { updateMany: jest.fn().mockResolvedValue({ count: claimedCount }), update: jest.fn() } } as any;
      const service = new AuthService({} as any, {} as any, buildConfigService(), {} as any, prisma, mfa);
      return { service, prisma };
    };

    it("primeiro uso: grava o passo com UPDATE condicional (so avanca, nunca repete)", async () => {
      const { service, prisma } = build(1);

      await (service as any).verifyAndPersistMfaCode(user(), codeFor(0));

      const call = prisma.user.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: "user-1",
        OR: [{ mfaLastTotpStep: null }, { mfaLastTotpStep: { lt: step } }],
      });
      expect(call.data.mfaLastTotpStep).toBe(step);
    });

    it("reuso do mesmo codigo: 401, porque o passo ja foi consumido", async () => {
      const { service } = build(0);

      await expect((service as any).verifyAndPersistMfaCode(user(), codeFor(0))).rejects.toThrow(
        "Esse codigo ja foi usado",
      );
    });

    it("codigo errado nao consome nada e cai no codigo de recuperacao", async () => {
      const { service, prisma } = build(1);
      const wrong = codeFor(0) === "123456" ? "654321" : "123456";

      await expect((service as any).verifyAndPersistMfaCode(user(), wrong)).rejects.toThrow(
        "Codigo MFA invalido",
      );
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
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
