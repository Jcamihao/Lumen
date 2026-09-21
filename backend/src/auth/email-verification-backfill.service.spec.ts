import { EmailVerificationBackfillService, maskEmail } from "./email-verification-backfill.service";

describe("EmailVerificationBackfillService", () => {
  const baseOptions = {
    send: true,
    delayMs: 0,
    force: false,
    allowLocalhost: false,
  };

  const build = (
    overrides: {
      users?: Array<{ id: string; email: string }>;
      pendingUserIds?: string[];
      mailEnabled?: boolean;
      frontendUrl?: string;
      dispatch?: jest.Mock;
    } = {},
  ) => {
    const users = overrides.users ?? [
      { id: "u1", email: "ana@example.com" },
      { id: "u2", email: "bia@example.com" },
      { id: "u3", email: "caio@example.com" },
    ];
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue(users) },
      authChallenge: {
        findMany: jest
          .fn()
          .mockResolvedValue((overrides.pendingUserIds ?? []).map((userId) => ({ userId }))),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === "mail.enabled") return overrides.mailEnabled ?? true;
        if (key === "app.frontendUrl") return overrides.frontendUrl ?? "https://financelumen.tech";
        return undefined;
      }),
    };
    const auth = {
      dispatchEmailVerification:
        overrides.dispatch ??
        jest.fn().mockResolvedValue({ alreadyVerified: false, skipped: false }),
    };
    const service = new EmailVerificationBackfillService(prisma as any, config as any, auth as any);

    return { service, prisma, auth };
  };

  it("em ensaio lista quem receberia e nao envia nem grava nada", async () => {
    const { service, auth, prisma } = build();

    const report = await service.run({ ...baseOptions, send: false });

    expect(report.dryRun).toBe(true);
    expect(report.candidates).toBe(3);
    expect(report.sent).toBe(0);
    expect(auth.dispatchEmailVerification).not.toHaveBeenCalled();
    expect(prisma.authChallenge.deleteMany).not.toHaveBeenCalled();
  });

  it("envia para todas as contas sem confirmacao", async () => {
    const { service, auth } = build();

    const report = await service.run(baseOptions);

    expect(auth.dispatchEmailVerification).toHaveBeenCalledTimes(3);
    expect(report.sent).toBe(3);
    expect(report.failed).toBe(0);
  });

  it("so considera quem ainda nao confirmou", async () => {
    const { service, prisma } = build();

    await service.run(baseOptions);

    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ emailVerifiedAt: null });
  });

  it("pula quem ja tem um link valido na caixa (nao invalida o link anterior)", async () => {
    const { service, auth } = build({ pendingUserIds: ["u2"] });

    const report = await service.run(baseOptions);

    expect(report.skippedAlreadyHasLink).toBe(1);
    expect(report.sent).toBe(2);
    expect(auth.dispatchEmailVerification).not.toHaveBeenCalledWith("u2");
  });

  it("com --force reenvia mesmo para quem ja tem link", async () => {
    const { service, auth } = build({ pendingUserIds: ["u2"] });

    const report = await service.run({ ...baseOptions, force: true });

    expect(report.sent).toBe(3);
    expect(auth.dispatchEmailVerification).toHaveBeenCalledWith("u2");
  });

  it("uma falha nao derruba o lote e limpa o link daquela conta", async () => {
    const dispatch = jest
      .fn()
      .mockResolvedValueOnce({ alreadyVerified: false, skipped: false })
      .mockRejectedValueOnce(new Error("Resend 500"))
      .mockResolvedValueOnce({ alreadyVerified: false, skipped: false });
    const { service, prisma } = build({ dispatch });

    const report = await service.run(baseOptions);

    expect(report.sent).toBe(2);
    expect(report.failed).toBe(1);
    expect(prisma.authChallenge.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u2", type: "EMAIL_VERIFICATION", completedAt: null },
    });
  });

  it("trata envio pulado pelo provedor como falha (nao como enviado)", async () => {
    const dispatch = jest.fn().mockResolvedValue({ alreadyVerified: false, skipped: true });
    const { service } = build({ dispatch, users: [{ id: "u1", email: "ana@example.com" }] });

    const report = await service.run(baseOptions);

    expect(report.sent).toBe(0);
    expect(report.failed).toBe(1);
  });

  it("recusa enviar com o Resend desligado", async () => {
    const { service, auth } = build({ mailEnabled: false });

    await expect(service.run(baseOptions)).rejects.toThrow(/RESEND_ENABLED/);
    expect(auth.dispatchEmailVerification).not.toHaveBeenCalled();
  });

  it("recusa enviar com links apontando para localhost, salvo autorizacao explicita", async () => {
    const { service, auth } = build({ frontendUrl: "http://localhost:4200" });

    await expect(service.run(baseOptions)).rejects.toThrow(/FRONTEND_URL/);
    expect(auth.dispatchEmailVerification).not.toHaveBeenCalled();

    await expect(service.run({ ...baseOptions, allowLocalhost: true })).resolves.toBeDefined();
  });

  it("o ensaio funciona mesmo com Resend desligado (so lista)", async () => {
    const { service } = build({ mailEnabled: false, frontendUrl: "http://localhost:4200" });

    await expect(service.run({ ...baseOptions, send: false })).resolves.toMatchObject({
      dryRun: true,
    });
  });

  it("filtra por um email e respeita o limite", async () => {
    const { service, prisma } = build();

    await service.run({ ...baseOptions, send: false, email: "  Ana@Example.com ", limit: 5 });

    const query = prisma.user.findMany.mock.calls[0][0];
    expect(query.where.email).toBe("ana@example.com");
    expect(query.take).toBe(5);
  });

  it("nunca imprime o email inteiro no relatorio", async () => {
    const { service } = build();

    const report = await service.run(baseOptions);

    expect(report.lines.join("\n")).not.toContain("ana@example.com");
    expect(report.lines[0]).toContain("a**@example.com");
  });

  it("maskEmail preserva o dominio e esconde o resto do usuario", () => {
    expect(maskEmail("marina@gmail.com")).toBe("m*****@gmail.com");
    expect(maskEmail("a@x.com")).toBe("a*@x.com");
  });
});
