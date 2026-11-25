import { BadRequestException, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { UsersService } from "./users.service";

describe("UsersService — LGPD (excluir e exportar)", () => {
  const buildService = (prisma: Record<string, unknown>) =>
    new UsersService(prisma as any, { get: jest.fn() } as any);

  describe("deleteMe", () => {
    const passwordHash = bcrypt.hashSync("senha-correta", 4);

    const buildPrisma = (user: unknown = { passwordHash }) => ({
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        delete: jest.fn().mockResolvedValue({}),
      },
    });

    it("recusa com 400 e nao apaga nada quando a senha esta errada", async () => {
      const prisma = buildPrisma();
      const service = buildService(prisma);

      await expect(service.deleteMe("user-1", "senha-errada")).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it("apaga a conta do proprio usuario quando a senha confere", async () => {
      const prisma = buildPrisma();
      const service = buildService(prisma);

      const result = await service.deleteMe("user-1", "senha-correta");

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: "user-1" },
      });
      expect(result.message).toContain("excluidos");
    });

    it("responde 404 quando o usuario nao existe mais", async () => {
      const prisma = buildPrisma(null);
      const service = buildService(prisma);

      await expect(service.deleteMe("user-1", "qualquer")).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });
  });

  describe("exportMe", () => {
    const decimal = (value: number) => ({ toString: () => String(value), valueOf: () => value });
    const baseUser = () => ({
      id: "user-1",
      name: "Marina",
      email: "marina@example.com",
      passwordHash: "hash-secreto",
      mfaTotpSecretEncrypted: "mfa-secreto",
      mfaPendingTotpSecretEncrypted: null,
      mfaRecoveryCodes: null,
      monthlyIncome: decimal(5000),
      privacyNoticeAcceptedAt: new Date("2026-01-01"),
      privacyNoticeVersion: "v1",
      aiAssistantEnabled: true,
      aiAssistantConsentAt: new Date("2026-01-01"),
      aiAssistantConsentVersion: "v1",
      taskCategories: [],
      financeCategories: [],
      tagGroups: [{ id: "tg-1", name: "Casa" }],
      tasks: [{ id: "t-1", title: "Pagar luz", estimatedAmount: null }],
      transactions: [{ id: "tx-1", description: "Mercado", amount: decimal(42.5) }],
      goals: [],
      reminders: [],
      insights: [],
      forecasts: [],
      forecastSnapshots: [
        {
          id: "fs-1",
          predictedBalance: decimal(1000),
          actualBalance: decimal(900),
          errorPercent: decimal(10),
        },
      ],
      importJobs: [],
      receiptScans: [],
      notifications: [],
      recurringTransactions: [
        { id: "rr-1", description: "Aluguel", amount: decimal(1200), frequency: "MONTHLY" },
      ],
      assistantTurns: [{ id: "at-1", question: "Como estou?", answer: "Bem." }],
      supportRequests: [{ id: "sr-1", subject: "Ajuda", message: "Preciso de ajuda" }],
      authSessions: [
        { id: "s-1", userAgent: "Chrome", ipAddress: "10.0.0.1", createdAt: new Date() },
      ],
    });

    const exportWith = (user: unknown) =>
      buildService({
        user: { findUnique: jest.fn().mockResolvedValue(user) },
      }).exportMe("user-1");

    it("inclui o historico do assistente, chamados, snapshots e sessoes", async () => {
      const data = await exportWith(baseUser());

      expect(data.datasets.assistantTurns).toHaveLength(1);
      expect(data.datasets.supportRequests).toHaveLength(1);
      expect(data.datasets.forecastSnapshots).toHaveLength(1);
      expect(data.datasets.authSessions).toHaveLength(1);
      expect(data.datasets.tagGroups).toHaveLength(1);
    });

    it("inclui as contas fixas, com o valor como numero", async () => {
      const data = await exportWith(baseUser());

      expect(data.datasets.recurringTransactions).toEqual([
        expect.objectContaining({ id: "rr-1", description: "Aluguel", amount: 1200 }),
      ]);
      expect(data.profile).not.toHaveProperty("recurringTransactions");
    });

    it("converte Decimals em numeros nos snapshots", async () => {
      const data = await exportWith(baseUser());

      expect(data.datasets.forecastSnapshots[0]).toMatchObject({
        predictedBalance: 1000,
        actualBalance: 900,
        errorPercent: 10,
      });
    });

    it("nunca vaza hash de senha nem segredo de MFA", async () => {
      const data = await exportWith(baseUser());
      const serialized = JSON.stringify(data);

      expect(serialized).not.toContain("hash-secreto");
      expect(serialized).not.toContain("mfa-secreto");
      expect(serialized).not.toContain("passwordHash");
      expect(serialized).not.toContain("refreshTokenHash");
    });

    it("mantem o profile so com dados da conta, sem repetir as listas", async () => {
      const data = await exportWith(baseUser());
      const profile = data.profile as Record<string, unknown>;

      for (const key of [
        "tasks",
        "transactions",
        "assistantTurns",
        "supportRequests",
        "authSessions",
      ]) {
        expect(profile).not.toHaveProperty(key);
      }
      expect(profile.email).toBe("marina@example.com");
    });

    it("responde 404 quando o usuario nao existe", async () => {
      await expect(exportWith(null)).rejects.toThrow(NotFoundException);
    });
  });
});

describe("UsersService - cartao padrao (9a-1)", () => {
  const buildService = (prisma: Record<string, unknown>) =>
    new UsersService(prisma as any, { get: jest.fn() } as any);

  describe("createUser", () => {
    const buildCreatePrisma = () => {
      const prisma: any = {
        user: {
          create: jest.fn().mockResolvedValue({ id: "user-new", monthClosingDay: 12 }),
        },
        creditCard: { create: jest.fn().mockResolvedValue({}) },
        taskCategory: { createMany: jest.fn().mockResolvedValue({}) },
        financeCategory: { createMany: jest.fn().mockResolvedValue({}) },
        tagGroup: { createMany: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
      return prisma;
    };
    const input = { name: "Ana", email: "ana@example.com", passwordHash: "hash", monthClosingDay: 12 };

    it("cria o cartao Principal padrao na mesma transacao que o User", async () => {
      const prisma = buildCreatePrisma();
      const service = buildService(prisma);
      jest.spyOn(service, "findById").mockResolvedValue({} as any);

      await service.createUser(input as any);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.create.mock.invocationCallOrder[0]).toBeLessThan(prisma.creditCard.create.mock.invocationCallOrder[0]);
      expect(prisma.creditCard.create).toHaveBeenCalledWith({
        data: {
          userId: "user-new",
          name: "Principal",
          closingDay: 12,
          dueDay: null,
          countAllPayments: false,
          isDefault: true,
        },
      });
    });

    it("falha ao criar o Principal: o cadastro falha e nao cria categorias", async () => {
      const prisma = buildCreatePrisma();
      prisma.creditCard.create.mockRejectedValueOnce(new Error("falha no cartao"));
      const service = buildService(prisma);
      jest.spyOn(service, "findById").mockResolvedValue({} as any);

      await expect(service.createUser(input as any)).rejects.toThrow("falha no cartao");
      expect(prisma.taskCategory.createMany).not.toHaveBeenCalled();
    });
  });

  describe("updateMe", () => {
    const buildUpdatePrisma = () => {
      const prisma: any = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ privacyNoticeAcceptedAt: new Date(), aiAssistantConsentAt: null }),
          update: jest.fn().mockResolvedValue({}),
        },
        creditCard: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      prisma.$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
      return prisma;
    };

    it("mudar o dia de fechamento pelo /users/me e ignorado (9c-2: so o cartao decide)", async () => {
      const prisma = buildUpdatePrisma();
      const service = buildService(prisma);
      jest.spyOn(service, "getMe").mockResolvedValue({} as any);

      await service.updateMe("user-1", { monthClosingDay: 12 } as any);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.creditCard.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty("monthClosingDay");
    });

    it("sem dia de fechamento no pedido: cartao padrao intacto", async () => {
      const prisma = buildUpdatePrisma();
      const service = buildService(prisma);
      jest.spyOn(service, "getMe").mockResolvedValue({} as any);

      await service.updateMe("user-1", { name: "Ana Maria" } as any);

      expect(prisma.creditCard.updateMany).not.toHaveBeenCalled();
    });
  });
});
