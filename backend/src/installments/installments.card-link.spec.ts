import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CARD_ARCHIVED_MESSAGE, CARD_NEEDS_CREDIT_MESSAGE, CARD_NOT_FOUND_MESSAGE } from '../credit-cards/card-link';
import { InstallmentsService } from './installments.service';

const USER_A = 'user-a';
const USER_B = 'user-b';
const USER_C = 'user-c';
const CARD_A1 = '11111111-1111-4111-8111-111111111111'; // A, padrao, ativo
const CARD_A2 = '22222222-2222-4222-8222-222222222222'; // A, secundario, arquivado
const CARD_B1 = '33333333-3333-4333-8333-333333333333'; // B, padrao, ativo
const MISSING = '44444444-4444-4444-8444-444444444444'; // nao existe

/** Cartoes em memoria: findFirst respeita id, userId, isDefault e archivedAt do where. */
const fakeCards = () => {
  const rows = [
    { id: CARD_A1, userId: USER_A, name: 'Nubank', isDefault: true, archivedAt: null, countAllPayments: false, closingDay: 5, dueDay: 12 },
    { id: CARD_A2, userId: USER_A, name: 'Inter', isDefault: false, archivedAt: new Date('2026-05-01T00:00:00Z'), countAllPayments: false, closingDay: 10, dueDay: 17 },
    { id: CARD_B1, userId: USER_B, name: 'Itau', isDefault: true, archivedAt: null, countAllPayments: false, closingDay: 3, dueDay: 9 },
  ];
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([key, value]) => {
      if (value === null) return row[key] === null || row[key] === undefined;
      return row[key] === value;
    });
  return {
    rows,
    creditCard: {
      findFirst: jest.fn(async ({ where }: any) => rows.find((row) => matches(row, where)) ?? null),
    },
  };
};

describe('InstallmentsService: cardId na compra parcelada (isolamento A/B/C)', () => {
  const build = (row: any = null) => {
    const cards = fakeCards();
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      creditCard: cards.creditCard,
      installmentPurchase: {
        findFirst: jest.fn().mockResolvedValue(row),
        findMany: jest.fn().mockResolvedValue(row ? [row] : []),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'plan-new', ...data, totalAmount: new Prisma.Decimal(data.totalAmount ?? 100), installmentAmount: new Prisma.Decimal(data.installmentAmount), nextDueDate: data.nextDueDate, installmentsGenerated: 0 }),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      financeCategory: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
    };
    const materializer = { materializeDue: jest.fn().mockResolvedValue(0) };
    const lifeEngine = { touchUserData: jest.fn().mockResolvedValue(undefined) };
    const entitlements = { assertCanCreate: jest.fn().mockResolvedValue(undefined) };
    const service = new InstallmentsService(prisma, materializer as any, lifeEngine as any, entitlements as any);
    return { service, prisma };
  };
  const USER_A = 'user-a';
  const USER_B = 'user-b';
  const USER_C = 'user-c';
  const base = { description: 'Geladeira', totalAmount: 1000, installmentsTotal: 10, paymentMethod: 'CREDIT' };

  it('cartao proprio grava cardId e a resposta traz cardName, sem objeto card', async () => {
    const { service, prisma } = build({ id: 'plan-new', userId: USER_A, description: 'Geladeira', totalAmount: new Prisma.Decimal(1000), installmentAmount: new Prisma.Decimal(100), installmentsTotal: 10, installmentsGenerated: 0, nextDueDate: new Date(), anchorDay: 5, isActive: true, cardId: CARD_A1, card: { name: 'Nubank' } });
    const result: any = await service.create(USER_A, { ...base, cardId: CARD_A1 } as any);
    expect(prisma.installmentPurchase.create.mock.calls[0][0].data.cardId).toBe(CARD_A1);
    expect(result.cardName).toBe('Nubank');
    expect(result.card).toBeUndefined();
  });

  it('sem cardId nao escreve cardId e nao pega o lock', async () => {
    const { service, prisma } = build();
    await service.create(USER_A, { ...base } as any).catch(() => undefined);
    expect(prisma.installmentPurchase.create.mock.calls[0]?.[0].data.cardId).toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('cardId com DEBIT ou PIX = 400, sem criar', async () => {
    for (const paymentMethod of ['DEBIT', 'PIX']) {
      const { service, prisma } = build();
      await expect(service.create(USER_A, { ...base, paymentMethod, cardId: CARD_A1 } as any)).rejects.toThrow(CARD_NEEDS_CREDIT_MESSAGE);
      expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
    }
  });

  it('cartao alheio e inexistente = 404 com a mesma mensagem, sem criar', async () => {
    const { service, prisma } = build();
    const foreign = await service.create(USER_A, { ...base, cardId: CARD_B1 } as any).catch((e) => e);
    const missing = await service.create(USER_A, { ...base, cardId: MISSING } as any).catch((e) => e);
    expect(foreign).toBeInstanceOf(NotFoundException);
    expect(missing).toBeInstanceOf(NotFoundException);
    expect(foreign.message).toBe(CARD_NOT_FOUND_MESSAGE);
    expect(missing.message).toBe(foreign.message);
    expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
  });

  it('cartao arquivado nao aceita compra nova (400)', async () => {
    const { service, prisma } = build();
    await expect(service.create(USER_A, { ...base, cardId: CARD_A2 } as any)).rejects.toThrow(CARD_ARCHIVED_MESSAGE);
    expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
  });

  it('usuario C nao usa cartao de A nem de B', async () => {
    const { service } = build();
    await expect(service.create(USER_C, { ...base, cardId: CARD_A1 } as any)).rejects.toThrow(NotFoundException);
    await expect(service.create(USER_C, { ...base, cardId: CARD_B1 } as any)).rejects.toThrow(NotFoundException);
  });

  it('com cardId a compra roda sob o lock do User, antes de ler o cartao', async () => {
    const { service, prisma } = build();
    const order: string[] = [];
    prisma.$queryRaw.mockImplementation(async () => order.push('lock'));
    prisma.creditCard.findFirst.mockImplementation(async (args: any) => {
      order.push('card');
      return fakeCards().rows.find((c) => c.id === args.where.id && c.userId === args.where.userId) ?? null;
    });
    await service.create(USER_A, { ...base, cardId: CARD_A1 } as any).catch(() => undefined);
    expect(order[0]).toBe('lock');
  });

  it('listagem devolve cardName (sem N+1: o nome vem no include)', async () => {
    const row = { id: 'p1', userId: USER_A, description: 'x', totalAmount: new Prisma.Decimal(10), installmentAmount: new Prisma.Decimal(5), installmentsTotal: 2, installmentsGenerated: 0, nextDueDate: new Date(), anchorDay: 5, isActive: true, cardId: CARD_A1, category: null, card: { name: 'Nubank' } };
    const { service, prisma } = build(row);
    const [item]: any[] = await service.list(USER_A);
    expect(item.cardName).toBe('Nubank');
    expect(item.card).toBeUndefined();
    expect(prisma.installmentPurchase.findMany.mock.calls[0][0].include.card).toEqual({ select: { name: true } });
  });
});
