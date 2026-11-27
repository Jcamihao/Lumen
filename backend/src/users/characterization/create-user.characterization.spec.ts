import { UsersService } from "../users.service";
import { FIXED_NOW } from "./export-user.fixture";

describe("createUser - caracterizacao do cadastro", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  });
  afterEach(() => jest.useRealTimers());

  const buildPrisma = () => {
    const prisma: any = {
      user: { create: jest.fn(async ({ data }) => ({ id: "user-new", ...data })) },
      creditCard: { create: jest.fn().mockResolvedValue({}) },
      taskCategory: { createMany: jest.fn().mockResolvedValue({}) },
      financeCategory: { createMany: jest.fn().mockResolvedValue({}) },
      tagGroup: { createMany: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
    return prisma;
  };

  const createWith = async (input: Record<string, unknown>) => {
    const prisma = buildPrisma();
    const service = new UsersService(prisma, { get: jest.fn() } as any);
    const findById = jest.spyOn(service, "findById").mockResolvedValue({ id: "user-new" } as any);
    const result = await service.createUser({ name: "Ana", email: "ana@example.com", passwordHash: "hash", ...input } as any);
    return { prisma, findById, result };
  };

  it("cadastro completo com aceite e IA: gravacoes, transacao e retorno", async () => {
    const { prisma, findById, result } = await createWith({
      avatarUrl: "https://cdn.example.com/a.png",
      phone: "11999990000",
      birthDate: "1990-05-10",
      occupation: "Engenheira",
      primaryGoal: "Reserva",
      role: "ADMIN",
      preferredCurrency: "USD",
      monthlyIncome: 4200,
      monthClosingDay: 12,
      timezone: "Europe/Lisbon",
      privacyNoticeAccepted: true,
      aiAssistantEnabled: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.create.mock.calls).toMatchSnapshot();
    expect(prisma.creditCard.create.mock.calls).toMatchSnapshot();
    expect(prisma.taskCategory.createMany.mock.calls).toMatchSnapshot();
    expect(prisma.financeCategory.createMany.mock.calls).toMatchSnapshot();
    expect(prisma.tagGroup.createMany.mock.calls).toMatchSnapshot();
    expect(findById).toHaveBeenCalledWith("user-new");
    expect(result).toEqual({ id: "user-new" });
  });

  it("cadastro minimo: padroes BRL, Sao Paulo, renda zero e cartao com dia 30", async () => {
    const { prisma } = await createWith({});

    expect(prisma.user.create.mock.calls).toMatchSnapshot();
    expect(prisma.creditCard.create.mock.calls).toMatchSnapshot();
  });

  it("IA pedida sem aceitar o aviso fica desligada e sem data de consentimento", async () => {
    const { prisma } = await createWith({ privacyNoticeAccepted: false, aiAssistantEnabled: true });

    expect(prisma.user.create.mock.calls).toMatchSnapshot();
  });

  it.each([
    [0, 1],
    [45, 31],
  ])("dia de fechamento %i vira %i no cartao Principal", async (input, expected) => {
    const { prisma } = await createWith({ monthClosingDay: input });

    expect(prisma.creditCard.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ closingDay: expected, isDefault: true, name: "Principal" }),
    });
  });

  it("falha no cartao Principal: nao cria categorias nem tags", async () => {
    const prisma = buildPrisma();
    prisma.creditCard.create.mockRejectedValueOnce(new Error("falha no cartao"));
    const service = new UsersService(prisma, { get: jest.fn() } as any);

    await expect(service.createUser({ name: "A", email: "a@a.com", passwordHash: "h" } as any)).rejects.toThrow("falha no cartao");
    expect(prisma.taskCategory.createMany).not.toHaveBeenCalled();
    expect(prisma.tagGroup.createMany).not.toHaveBeenCalled();
  });
});
