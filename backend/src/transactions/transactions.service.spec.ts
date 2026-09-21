import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TransactionsService } from "./transactions.service";

describe("TransactionsService", () => {
  const buildPrisma = (overrides: Partial<Record<string, any>> = {}) =>
    ({
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: "tx-new", ...data }),
        ),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: "tx-1", ...data }),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      financeCategory: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      task: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      goal: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      ...overrides,
    }) as any;

  const buildMaterializer = (created = 0) =>
    ({
      materializeDue: jest.fn().mockResolvedValue(created),
    }) as any;

  const buildLifeEngine = () =>
    ({
      touchUserData: jest.fn().mockResolvedValue(undefined),
    }) as any;

  describe('conflito de data em lancamento de conta fixa', () => {
    it('devolve 400 quando o indice unico (conta fixa + data) recusa a edicao', async () => {
      const prisma = buildPrisma({
        transaction: {
          findMany: jest.fn(),
          findFirst: jest.fn().mockResolvedValue({ id: 'tx-1', userId: 'user-1' }),
          update: jest
            .fn()
            .mockRejectedValue(Object.assign(new Error('Unique'), { code: 'P2002' })),
          create: jest.fn(),
          delete: jest.fn(),
        },
      });
      const service = new TransactionsService(prisma, buildLifeEngine(), buildMaterializer());

      await expect(
        service.update('user-1', 'tx-1', { date: '2026-10-05' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('outros erros do banco continuam subindo', async () => {
      const prisma = buildPrisma({
        transaction: {
          findMany: jest.fn(),
          findFirst: jest.fn().mockResolvedValue({ id: 'tx-1', userId: 'user-1' }),
          update: jest.fn().mockRejectedValue(new Error('conexao caiu')),
          create: jest.fn(),
          delete: jest.fn(),
        },
      });
      const service = new TransactionsService(prisma, buildLifeEngine(), buildMaterializer());

      await expect(service.update('user-1', 'tx-1', { description: 'x' } as any)).rejects.toThrow(
        'conexao caiu',
      );
    });
  });

  describe('contas fixas vencidas', () => {
    it('gera os lancamentos vencidos antes de listar e recalcula os insights', async () => {
      const prisma = buildPrisma();
      const materializer = buildMaterializer(2);
      const lifeEngine = buildLifeEngine();
      const service = new TransactionsService(prisma, lifeEngine, materializer);

      await service.list('user-1', {} as any);

      expect(materializer.materializeDue).toHaveBeenCalledWith('user-1');
      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
      // A geracao vem ANTES da consulta, senao a lista sairia sem elas.
      expect(materializer.materializeDue.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.transaction.findMany.mock.invocationCallOrder[0],
      );
    });

    it('nao mexe nos insights quando nada venceu', async () => {
      const lifeEngine = buildLifeEngine();
      const service = new TransactionsService(buildPrisma(), lifeEngine, buildMaterializer(0));

      await service.list('user-1', {} as any);

      expect(lifeEngine.touchUserData).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("always scopes the query by the requesting user's id", async () => {
      const prisma = buildPrisma();
      const service = new TransactionsService(prisma, buildLifeEngine(), buildMaterializer());

      await service.list("user-1", {} as any);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-1" }),
        }),
      );
    });
  });

  describe("create", () => {
    it("stores the amount as a positive value regardless of the sign received", async () => {
      const prisma = buildPrisma();
      const service = new TransactionsService(prisma, buildLifeEngine(), buildMaterializer());

      await service.create("user-1", {
        type: "EXPENSE",
        description: "Conta de luz",
        amount: -220,
        date: "2026-08-01T00:00:00.000Z",
      } as any);

      const createCall = prisma.transaction.create.mock.calls[0][0];
      expect(createCall.data.userId).toBe("user-1");
      expect(createCall.data.amount.toNumber()).toBe(220);
    });

    it("rejects a category that does not belong to the requesting user", async () => {
      const prisma = buildPrisma();
      const service = new TransactionsService(prisma, buildLifeEngine(), buildMaterializer());

      await expect(
        service.create("user-1", {
          type: "EXPENSE",
          description: "Conta de luz",
          amount: 220,
          date: "2026-08-01T00:00:00.000Z",
          categoryId: "category-of-another-user",
        } as any),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.financeCategory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "category-of-another-user", userId: "user-1" },
        }),
      );
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe("list — month filter", () => {
    it("uses UTC month boundaries so a 1st-of-month entry stays in its own month", async () => {
      const prisma = buildPrisma();
      const service = new TransactionsService(prisma, buildLifeEngine(), buildMaterializer());

      await service.list("user-1", { month: 9, year: 2026 } as any);

      const { gte, lte } = prisma.transaction.findMany.mock.calls[0][0].where.date;
      expect(gte.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(lte.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    });

    it("rolls December over to the end of the year correctly", async () => {
      const prisma = buildPrisma();
      const service = new TransactionsService(prisma, buildLifeEngine(), buildMaterializer());

      await service.list("user-1", { month: 12, year: 2026 } as any);

      const { gte, lte } = prisma.transaction.findMany.mock.calls[0][0].where.date;
      expect(gte.toISOString()).toBe("2026-12-01T00:00:00.000Z");
      expect(lte.toISOString()).toBe("2026-12-31T23:59:59.999Z");
    });
  });

  describe("update / remove — multi-tenancy", () => {
    it("update() never touches a transaction owned by another user", async () => {
      const prisma = buildPrisma();
      const service = new TransactionsService(prisma, buildLifeEngine(), buildMaterializer());

      await expect(
        service.update("user-1", "tx-owned-by-someone-else", {
          description: "tentativa de editar transacao alheia",
        } as any),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.transaction.findFirst).toHaveBeenCalledWith({
        where: { id: "tx-owned-by-someone-else", userId: "user-1" },
      });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it("remove() never deletes a transaction owned by another user", async () => {
      const prisma = buildPrisma();
      const service = new TransactionsService(prisma, buildLifeEngine(), buildMaterializer());

      await expect(
        service.remove("user-1", "tx-owned-by-someone-else"),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.transaction.findFirst).toHaveBeenCalledWith({
        where: { id: "tx-owned-by-someone-else", userId: "user-1" },
      });
      expect(prisma.transaction.delete).not.toHaveBeenCalled();
    });

    it("update() succeeds when the transaction belongs to the requesting user", async () => {
      const prisma = buildPrisma({
        transaction: {
          findMany: jest.fn(),
          findFirst: jest.fn().mockResolvedValue({ id: "tx-1", userId: "user-1" }),
          update: jest.fn().mockImplementation(({ data }: any) =>
            Promise.resolve({ id: "tx-1", ...data }),
          ),
          delete: jest.fn(),
          create: jest.fn(),
        },
      });
      const service = new TransactionsService(prisma, buildLifeEngine(), buildMaterializer());

      const result = await service.update("user-1", "tx-1", {
        description: "Conta de luz atualizada",
      } as any);

      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "tx-1" } }),
      );
      expect(result.description).toBe("Conta de luz atualizada");
    });
  });
});
