import { BadRequestException } from "@nestjs/common";
import { UsersService } from "../users.service";
import { FIXED_NOW } from "./export-user.fixture";

describe("updateMe e sanitizeUser - caracterizacao da conta", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  });
  afterEach(() => jest.useRealTimers());

  const buildPrisma = (current: Record<string, unknown> | null) => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
    return prisma;
  };

  const updateWith = async (current: Record<string, unknown>, dto: Record<string, unknown>) => {
    const prisma = buildPrisma(current);
    const service = new UsersService(prisma, { get: jest.fn() } as any);
    jest.spyOn(service, "getMe").mockResolvedValue({} as any);
    await service.updateMe("user-1", dto as any);
    return prisma.user.update.mock.calls[0][0];
  };

  const noConsent = { id: "user-1", privacyNoticeAcceptedAt: null, aiAssistantConsentAt: null };
  const accepted = { id: "user-1", privacyNoticeAcceptedAt: new Date("2025-06-01T00:00:00.000Z"), aiAssistantConsentAt: new Date("2025-06-02T00:00:00.000Z") };

  it("dados comuns, emails e renda", async () => {
    expect(await updateWith(accepted, {
      name: "Ana", avatarUrl: "x.png", phone: "1", birthDate: "1991-01-02", occupation: "Dev", primaryGoal: "Casa",
      preferredCurrency: "USD", monthlyIncome: 100, timezone: "UTC", emailWeeklyDigest: false, emailReminders: true,
      emailInsightAlerts: false, emailBillReminders: true,
    })).toMatchSnapshot();
  });

  it("ativar IA com aceite agora preserva a data de consentimento anterior", async () => {
    expect(await updateWith(accepted, { aiAssistantEnabled: true })).toMatchSnapshot();
  });

  it("ativar IA e aceitar o aviso no mesmo pedido grava as duas datas agora", async () => {
    expect(await updateWith(noConsent, { aiAssistantEnabled: true, privacyNoticeAccepted: true })).toMatchSnapshot();
  });

  it("desligar IA limpa consentimento; sem campo de IA nao toca nela", async () => {
    expect(await updateWith(accepted, { aiAssistantEnabled: false })).toMatchSnapshot();
    expect(await updateWith(accepted, { name: "So nome" })).toMatchSnapshot();
  });

  it("recusa ativar IA sem aviso aceito e nao grava nada", async () => {
    const prisma = buildPrisma(noConsent);
    const service = new UsersService(prisma, { get: jest.fn() } as any);

    await expect(service.updateMe("user-1", { aiAssistantEnabled: true } as any)).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("sanitizeUser: sem segredos de MFA, com flags conforme a feature", async () => {
    const user = {
      id: "user-1", passwordHash: "h", mfaTotpSecretEncrypted: "s", mfaPendingTotpSecretEncrypted: "p",
      mfaRecoveryCodes: [{ usedAt: null }, { usedAt: "2026-01-01" }], mfaLastTotpStep: 9, mfaEnabledAt: new Date("2026-01-03T00:00:00.000Z"),
      mfaLastVerifiedAt: null, monthlyIncome: { toString: () => "3000" }, financeCategories: [],
    };
    const on = new UsersService({} as any, { get: jest.fn(() => true) } as any);
    const off = new UsersService({} as any, { get: jest.fn(() => false) } as any);

    expect(await on.sanitizeUser(user as any)).toMatchSnapshot();
    expect(await off.sanitizeUser(user as any)).toMatchSnapshot();
  });
});
