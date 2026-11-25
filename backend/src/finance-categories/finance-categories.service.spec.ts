import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { FinanceCategoriesService } from './finance-categories.service';

const access = { canSeeItem: async (r: string, i: any) => i.userId === r, scopeWhere: async (userId: string) => ({ userId }), firstNamesById: async () => new Map() } as any;

// Decimal do Prisma: serializa como string; Number() resolve.
const decimal = (value: number) => ({ toString: () => String(value), valueOf: () => value }) as any;

describe('FinanceCategoriesService — orcamento mensal', () => {
  const lifeEngine = () => ({ touchUserData: jest.fn().mockResolvedValue(undefined) });

  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: 'cat-1',
    userId: 'user-1',
    name: 'Alimentacao',
    color: '#f00',
    icon: null,
    type: TransactionType.EXPENSE,
    monthlyBudget: null,
    ...overrides,
  });

  const buildPrisma = (existing: unknown = stored()) => ({
    financeCategory: {
      findFirst: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(stored(data))),
      update: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...(existing as object), ...data }),
      ),
    },
    transaction: { updateMany: jest.fn() },
  });

  it('cria categoria de despesa com orcamento e devolve numero', async () => {
    const prisma = buildPrisma();
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    const result = await service.create('user-1', {
      name: 'Mercado',
      color: '#0f0',
      type: TransactionType.EXPENSE,
      monthlyBudget: 800,
    });

    expect(prisma.financeCategory.create.mock.calls[0][0].data.monthlyBudget).toBe(800);
    expect(result.monthlyBudget).toBe(800);
  });

  it('recusa orcamento em categoria de receita (400)', async () => {
    const prisma = buildPrisma();
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    await expect(
      service.create('user-1', {
        name: 'Salario',
        color: '#0f0',
        type: TransactionType.INCOME,
        monthlyBudget: 100,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.financeCategory.create).not.toHaveBeenCalled();
  });

  it('define o orcamento de uma categoria de despesa existente', async () => {
    const prisma = buildPrisma();
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    const result = await service.update('user-1', 'cat-1', { monthlyBudget: 1000 });

    expect(prisma.financeCategory.update.mock.calls[0][0].data.monthlyBudget).toBe(1000);
    expect((result as any).monthlyBudget).toBe(1000);
  });

  it('remove o orcamento quando recebe null', async () => {
    const prisma = buildPrisma(stored({ monthlyBudget: decimal(1000) }));
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    const result = await service.update('user-1', 'cat-1', { monthlyBudget: null });

    expect(prisma.financeCategory.update.mock.calls[0][0].data.monthlyBudget).toBeNull();
    expect((result as any).monthlyBudget).toBeNull();
  });

  it('recusa orcamento em categoria que nao e de despesa', async () => {
    const prisma = buildPrisma(stored({ type: TransactionType.INCOME }));
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    await expect(
      service.update('user-1', 'cat-1', { monthlyBudget: 500 }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.financeCategory.update).not.toHaveBeenCalled();
  });

  it('limpa o teto quando a categoria deixa de ser despesa', async () => {
    const prisma = buildPrisma(stored({ monthlyBudget: decimal(900) }));
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    await service.update('user-1', 'cat-1', { type: TransactionType.INCOME });

    expect(prisma.financeCategory.update.mock.calls[0][0].data.monthlyBudget).toBeNull();
  });

  it('nao mexe em categoria de outro usuario', async () => {
    const prisma = buildPrisma(null);
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    await expect(
      service.update('user-1', 'cat-alheia', { monthlyBudget: 10 }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.financeCategory.findFirst).toHaveBeenCalledWith({
      where: { id: 'cat-alheia', OR: [{ userId: 'user-1' }, { sharedGroupOwnerId: { not: null } }] },
    });
    expect(prisma.financeCategory.update).not.toHaveBeenCalled();
  });

  it('lista com o orcamento convertido em numero', async () => {
    const prisma = buildPrisma();
    prisma.financeCategory.findMany.mockResolvedValue([
      stored({ monthlyBudget: decimal(750.5) }),
      stored({ id: 'cat-2', monthlyBudget: null }),
    ]);
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    const result = await service.list('user-1');

    expect(result.map((category) => category.monthlyBudget)).toEqual([750.5, null]);
  });

  it('recalcula os insights quando o orcamento muda, mas nao quando so o nome muda', async () => {
    const prisma = buildPrisma();
    const engine = lifeEngine();
    const service = new FinanceCategoriesService(prisma as any, engine as any, access);

    await service.update('user-1', 'cat-1', { name: 'Mercado e feira' });
    expect(engine.touchUserData).not.toHaveBeenCalled();

    await service.update('user-1', 'cat-1', { monthlyBudget: 900 });
    expect(engine.touchUserData).toHaveBeenCalledWith('user-1');
  });

  it('nome duplicado (indice unico userId+name+type) vira 400 legivel, nao o 500 cru do banco', async () => {
    const prisma = buildPrisma();
    prisma.financeCategory.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    await expect(
      service.create('user-1', { name: 'Alimentacao', color: '#f00', type: TransactionType.EXPENSE }),
    ).rejects.toThrow(BadRequestException);
  });

  it('renomear pra um nome que ja existe tambem vira 400 legivel', async () => {
    const prisma = buildPrisma();
    prisma.financeCategory.update.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    await expect(service.update('user-1', 'cat-1', { name: 'Alimentacao' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('erro que nao e de unicidade continua subindo (nao e engolido)', async () => {
    const prisma = buildPrisma();
    prisma.financeCategory.create.mockRejectedValue(new Error('conexao caiu'));
    const service = new FinanceCategoriesService(prisma as any, lifeEngine() as any, access);

    await expect(
      service.create('user-1', { name: 'Mercado', color: '#0f0', type: TransactionType.EXPENSE }),
    ).rejects.toThrow('conexao caiu');
  });
});
