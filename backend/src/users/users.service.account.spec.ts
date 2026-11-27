import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { UsersService } from "./users.service";

describe("UsersService - consultas e escritas simples da conta", () => {
  const FIXED_NOW = new Date("2026-02-01T12:00:00.000Z");
  const buildPrisma = (found: unknown = { id: "u-1" }) => ({
    user: {
      findUnique: jest.fn().mockResolvedValue(found),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  });
  const build = (prisma: ReturnType<typeof buildPrisma>) =>
    new UsersService(prisma as any, { get: jest.fn() } as any);

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  });
  afterEach(() => jest.useRealTimers());

  it("findByEmail consulta pelo email recebido", async () => {
    const prisma = buildPrisma();
    await build(prisma).findByEmail("ana@example.com");

    expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({ email: "ana@example.com" });
  });

  it("findById consulta pelo id, ordena listas e responde 404 sem usuario", async () => {
    const prisma = buildPrisma();
    await build(prisma).findById("u-1");
    expect(prisma.user.findUnique.mock.calls[0][0]).toEqual({
      where: { id: "u-1" },
      include: {
        taskCategories: { orderBy: { name: "asc" } },
        financeCategories: { orderBy: { name: "asc" } },
        tagGroups: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      },
    });

    await expect(build(buildPrisma(null)).findById("x")).rejects.toThrow(NotFoundException);
  });

  it("updatePassword grava so o hash recebido no proprio usuario", async () => {
    const prisma = buildPrisma();
    await build(prisma).updatePassword("u-1", "novo-hash");

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-1" }, data: { passwordHash: "novo-hash" } });
  });

  it("markEmailVerified so marca quem ainda nao verificou", async () => {
    const prisma = buildPrisma();
    await build(prisma).markEmailVerified("u-1");

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u-1", emailVerifiedAt: null },
      data: { emailVerifiedAt: FIXED_NOW },
    });
  });

  it("updateLastLogin grava a hora atual no proprio usuario", async () => {
    const prisma = buildPrisma();
    await build(prisma).updateLastLogin("u-1");

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-1" }, data: { lastLoginAt: FIXED_NOW } });
  });

  it("updateMe responde 404 sem usuario, mesmo sem pedir IA, e nao grava", async () => {
    const prisma = buildPrisma(null);

    await expect(build(prisma).updateMe("u-1", { name: "Ana" } as any)).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("updateMe grava dentro da transacao e preserva a data do aviso ja aceito", async () => {
    const accepted = new Date("2025-06-01T00:00:00.000Z");
    const prisma = buildPrisma({ id: "u-1", privacyNoticeAcceptedAt: accepted, aiAssistantConsentAt: null });
    const tx = { user: { update: jest.fn().mockResolvedValue({}) } };
    prisma.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const service = build(prisma);
    jest.spyOn(service, "getMe").mockResolvedValue({} as any);

    await service.updateMe("u-1", { privacyNoticeAccepted: true } as any);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(tx.user.update.mock.calls[0][0].data.privacyNoticeAcceptedAt).toBe(accepted);
  });

  it("sanitizeUser converte renda e orcamento das categorias em numero", async () => {
    const user = {
      id: "u-1", monthlyIncome: new Prisma.Decimal("10.5"),
      financeCategories: [{ id: "c-1", monthlyBudget: new Prisma.Decimal("99.9") }],
    };
    const result = await build(buildPrisma()).sanitizeUser(user as any);

    expect(result.monthlyIncome).toBe(10.5);
    expect(result.financeCategories[0].monthlyBudget).toBe(99.9);
  });
});
