import { RateLimitGuard } from "./rate-limit.guard";

describe("RateLimitGuard — MFA", () => {
  const UUID_A = "11111111-1111-4111-8111-111111111111";
  const UUID_B = "22222222-2222-4222-8222-222222222222";

  // Sem Redis (hitRateLimitWindow -> null) o guard cai no contador em memoria.
  const buildGuard = () => new RateLimitGuard({ hitRateLimitWindow: jest.fn().mockResolvedValue(null) } as any);

  const call = async (
    guard: RateLimitGuard,
    path: string,
    body: Record<string, unknown>,
    ip = "203.0.113.10",
    user?: { sub: string },
  ) => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method: "POST", originalUrl: path, ip, body, user }),
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
    } as any;
    return guard.canActivate(ctx);
  };

  const hammer = async (guard: RateLimitGuard, times: number, ...args: Parameters<typeof call> extends [any, ...infer R] ? R : never) => {
    let blockedAt: number | null = null;
    for (let i = 1; i <= times; i += 1) {
      try {
        await call(guard, ...(args as [string, Record<string, unknown>, string?, { sub: string }?]));
      } catch {
        blockedAt = i;
        break;
      }
    }
    return blockedAt;
  };

  it("verify-login: bloqueia na 6a tentativa do MESMO desafio, mesmo trocando de IP", async () => {
    const guard = buildGuard();
    let blockedAt: number | null = null;

    for (let i = 1; i <= 10 && blockedAt === null; i += 1) {
      try {
        await call(guard, "/api/v1/auth/mfa/verify-login", { challengeId: UUID_A }, `198.51.100.${i}`);
      } catch {
        blockedAt = i;
      }
    }

    expect(blockedAt).toBe(6);
  });

  it("verify-login: outro desafio tem balde proprio", async () => {
    const guard = buildGuard();
    await hammer(guard, 10, "/api/v1/auth/mfa/verify-login", { challengeId: UUID_A });

    await expect(call(guard, "/api/v1/auth/mfa/verify-login", { challengeId: UUID_B })).resolves.toBe(true);
  });

  it("email-bypass/request: no maximo 3 emails por desafio", async () => {
    const guard = buildGuard();

    expect(await hammer(guard, 10, "/api/v1/auth/mfa/email-bypass/request", { challengeId: UUID_A })).toBe(4);
  });

  it("email-bypass/verify: no maximo 5 tentativas por codigo emitido", async () => {
    const guard = buildGuard();

    expect(await hammer(guard, 10, "/api/v1/auth/mfa/email-bypass/verify", { bypassChallengeId: UUID_A })).toBe(6);
  });

  it("desativar/confirmar MFA: 10 tentativas por usuario", async () => {
    const guard = buildGuard();

    expect(
      await hammer(guard, 20, "/api/v1/auth/mfa/disable", { code: "123456" }, "203.0.113.10", { sub: "user-1" }),
    ).toBe(11);
  });

  it("id de desafio invalido cai num balde por IP (lixo nao esgota o balde de um desafio real)", async () => {
    const guard = buildGuard();
    await hammer(guard, 10, "/api/v1/auth/mfa/verify-login", { challengeId: "lixo" }, "203.0.113.99");

    await expect(call(guard, "/api/v1/auth/mfa/verify-login", { challengeId: UUID_A })).resolves.toBe(true);
  });

  it("billing/checkout: bloqueia na 6a tentativa do mesmo usuario na mesma hora", async () => {
    const guard = buildGuard();

    expect(
      await hammer(guard, 10, "/api/v1/billing/checkout", {}, "203.0.113.10", { sub: "user-1" }),
    ).toBe(6);
  });

  it("billing/webhooks/asaas: bloqueia na 301a chamada do mesmo IP em 5 minutos", async () => {
    const guard = buildGuard();

    expect(await hammer(guard, 302, "/api/v1/billing/webhooks/asaas", {}, "203.0.113.10")).toBe(
      301,
    );
  });

  it("billing/webhooks/asaas: IP diferente tem balde proprio", async () => {
    const guard = buildGuard();
    await hammer(guard, 300, "/api/v1/billing/webhooks/asaas", {}, "203.0.113.10");

    await expect(
      call(guard, "/api/v1/billing/webhooks/asaas", {}, "203.0.113.11"),
    ).resolves.toBe(true);
  });

  it("billing/sync: bloqueia na 11a tentativa do mesmo usuario na mesma hora", async () => {
    const guard = buildGuard();

    expect(
      await hammer(guard, 15, "/api/v1/billing/sync", {}, "203.0.113.10", { sub: "user-1" }),
    ).toBe(11);
  });

  it("whatsapp/webhook: bloqueia na 601a chamada do mesmo IP em 5 minutos", async () => {
    const guard = buildGuard();

    expect(await hammer(guard, 602, "/api/v1/whatsapp/webhook", {}, "203.0.113.10")).toBe(601);
  });

  it("whatsapp/link-code: bloqueia na 6a geracao do mesmo usuario na mesma hora", async () => {
    const guard = buildGuard();

    expect(
      await hammer(guard, 10, "/api/v1/whatsapp/link-code", {}, "203.0.113.10", { sub: "user-1" }),
    ).toBe(6);
  });
});
