import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RecurrenceFrequency, TransactionType } from '@prisma/client';
import { CARD_ARCHIVED_MESSAGE, CARD_NEEDS_CREDIT_MESSAGE, CARD_NOT_FOUND_MESSAGE } from '../credit-cards/card-link';
import { utcDate } from './recurrence.util';
import { RecurringTransactionsService } from './recurring-transactions.service';

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

describe('RecurringTransactionsService: cardId em conta fixa (isolamento A/B/C)', () => {
  const today = () => {
    const now = new Date();
    return utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  };
  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: 'rec-1', userId: USER_A, type: TransactionType.EXPENSE, description: 'Aluguel', amount: 1200,
    categoryId: null, paymentMethod: 'CREDIT', cardId: CARD_A1, frequency: RecurrenceFrequency.MONTHLY,
    anchorDay: 5, nextDueDate: utcDate(2027, 0, 5), endDate: null, isActive: true, category: null, card: { name: 'Nubank' },
    ...overrides,
  });
  const build = (existing: any = stored()) => {
    const cards = fakeCards();
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      creditCard: cards.creditCard,
      recurringTransaction: {
        findFirst: jest.fn().mockResolvedValue(existing),
        findMany: jest.fn().mockResolvedValue(existing ? [existing] : []),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rec-new', ...data, amount: data.amount, card: { name: 'Nubank' } })),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      financeCategory: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
    };
    const materializer = { materializeDue: jest.fn().mockResolvedValue(0) };
    const lifeEngine = { touchUserData: jest.fn().mockResolvedValue(undefined) };
    const entitlements = { assertCanCreate: jest.fn().mockResolvedValue(undefined) };
    const service = new RecurringTransactionsService(prisma, materializer as any, lifeEngine as any, entitlements as any);
    return { service, prisma };
  };
  const USER_A = 'user-a';
  const USER_B = 'user-b';
  const USER_C = 'user-c';
  const base = {
    type: TransactionType.EXPENSE, description: 'Aluguel', amount: 1200,
    frequency: RecurrenceFrequency.MONTHLY, firstDueDate: today().toISOString().slice(0, 10), paymentMethod: 'CREDIT',
  };

  describe('criacao', () => {
    it('cartao proprio grava cardId e devolve cardName, sem objeto card', async () => {
      const { service, prisma } = build();
      const result: any = await service.create(USER_A, { ...base, cardId: CARD_A1 } as any);
      expect(prisma.recurringTransaction.create.mock.calls[0][0].data.cardId).toBe(CARD_A1);
      expect(result.cardName).toBe('Nubank');
      expect(result.card).toBeUndefined();
    });

    it('sem cardId nao escreve cardId e nao pega o lock', async () => {
      const { service, prisma } = build();
      await service.create(USER_A, { ...base } as any);
      expect(prisma.recurringTransaction.create.mock.calls[0][0].data.cardId).toBeUndefined();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('cardId com DEBIT ou PIX = 400, sem criar', async () => {
      const { service, prisma } = build(null);
      await expect(service.create(USER_A, { ...base, paymentMethod: 'PIX', cardId: CARD_A1 } as any)).rejects.toThrow(CARD_NEEDS_CREDIT_MESSAGE);
      expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('cartao alheio e inexistente = 404 com a mesma mensagem, sem criar', async () => {
      const { service, prisma } = build(null);
      const foreign = await service.create(USER_A, { ...base, cardId: CARD_B1 } as any).catch((e) => e);
      const missing = await service.create(USER_A, { ...base, cardId: MISSING } as any).catch((e) => e);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(missing).toBeInstanceOf(NotFoundException);
      expect(foreign.message).toBe(CARD_NOT_FOUND_MESSAGE);
      expect(missing.message).toBe(foreign.message);
      expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('cartao arquivado nao aceita conta nova (400)', async () => {
      const { service, prisma } = build(null);
      await expect(service.create(USER_A, { ...base, cardId: CARD_A2 } as any)).rejects.toThrow(CARD_ARCHIVED_MESSAGE);
      expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('edicao', () => {
    it('conta com cartao arquivado gravado: edicao sem cardId continua ok, cardId intocado', async () => {
      const { service, prisma } = build(stored({ cardId: CARD_A2 }));
      await service.update(USER_A, 'rec-1', { description: 'Novo' } as any);
      expect(prisma.recurringTransaction.update.mock.calls[0][0].data.cardId).toBeUndefined();
    });

    it('mesmo cartao arquivado ja gravado passa; trocar para outro arquivado nao', async () => {
      const { service, prisma } = build(stored({ cardId: CARD_A2 }));
      await service.update(USER_A, 'rec-1', { cardId: CARD_A2 } as any);
      expect(prisma.recurringTransaction.update.mock.calls[0][0].data.cardId).toBeUndefined();
      await expect(service.update(USER_A, 'rec-1', { cardId: CARD_A1 } as any)).resolves.toBeDefined();
    });

    it('trocar para cartao arquivado diferente = 400 e nao grava', async () => {
      const { service, prisma } = build(stored({ cardId: CARD_A1 }));
      await expect(service.update(USER_A, 'rec-1', { cardId: CARD_A2 } as any)).rejects.toThrow(CARD_ARCHIVED_MESSAGE);
      expect(prisma.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('sair de CREDIT limpa o cardId', async () => {
      const { service, prisma } = build(stored({ cardId: CARD_A1 }));
      await service.update(USER_A, 'rec-1', { paymentMethod: 'PIX' } as any);
      expect(prisma.recurringTransaction.update.mock.calls[0][0].data.cardId).toBeNull();
    });

    it('cardId null limpa o vinculo', async () => {
      const { service, prisma } = build(stored({ cardId: CARD_A1 }));
      await service.update(USER_A, 'rec-1', { cardId: null } as any);
      expect(prisma.recurringTransaction.update.mock.calls[0][0].data.cardId).toBeNull();
    });

    it('cartao alheio na edicao = 404 e nao grava', async () => {
      const { service, prisma } = build(stored({ cardId: null }));
      await expect(service.update(USER_A, 'rec-1', { cardId: CARD_B1 } as any)).rejects.toThrow(NotFoundException);
      expect(prisma.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('cardId enviado com conta em PIX (sem trocar a forma) = 400', async () => {
      const { service, prisma } = build(stored({ paymentMethod: 'PIX', cardId: null }));
      await expect(service.update(USER_A, 'rec-1', { cardId: CARD_A1 } as any)).rejects.toThrow(CARD_NEEDS_CREDIT_MESSAGE);
      expect(prisma.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('usuario B nao edita conta de A (404 antes de qualquer cartao)', async () => {
      const { service } = build(null);
      await expect(service.update(USER_B, 'rec-1', { cardId: CARD_B1 } as any)).rejects.toThrow(NotFoundException);
    });
  });

  it('listagem devolve cardName sem o objeto card', async () => {
    const { service } = build();
    const [item]: any[] = await service.list(USER_A);
    expect(item.cardName).toBe('Nubank');
    expect(item.card).toBeUndefined();
  });

  it('usuario C nao cria conta com cartao de A', async () => {
    const { service } = build(null);
    await expect(service.create(USER_C, { ...base, cardId: CARD_A1 } as any)).rejects.toThrow(NotFoundException);
  });
});
