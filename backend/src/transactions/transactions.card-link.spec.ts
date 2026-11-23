import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, TransactionType } from '@prisma/client';
import { TransactionsService } from './transactions.service';
import { CARD_ARCHIVED_MESSAGE, CARD_NEEDS_CREDIT_MESSAGE, CARD_NOT_FOUND_MESSAGE } from '../credit-cards/card-link';

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

describe('TransactionsService: cardId em lancamento (isolamento A/B/C)', () => {
  const build = (existing: any = null) => {
    const cards = fakeCards();
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      creditCard: cards.creditCard,
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'tx-new', ...data, card: data.cardId ? { name: cards.rows.find((c) => c.id === data.cardId)?.name } : null, amount: data.amount }),
        ),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'tx-1', userId: USER_A, ...data, card: data.cardId ? { name: cards.rows.find((c) => c.id === data.cardId)?.name } : null }),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      financeCategory: { findFirst: jest.fn().mockResolvedValue(null) },
      task: { findFirst: jest.fn().mockResolvedValue(null) },
      goal: { findFirst: jest.fn().mockResolvedValue(null) },
      envelope: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const materializer = { materializeDue: jest.fn().mockResolvedValue(0) };
    const lifeEngine = { touchUserData: jest.fn().mockResolvedValue(undefined) };
    const service = new TransactionsService(prisma, lifeEngine as any, materializer as any, materializer as any);
    return { service, prisma };
  };

  const base = { type: TransactionType.EXPENSE, description: 'Mercado', amount: 10, date: '2026-10-05' };
  const USER_A = 'user-a';
  const USER_B = 'user-b';
  const USER_C = 'user-c';

  it('cartao proprio com CREDIT grava cardId e devolve cardName, sem objeto card', async () => {
    const { service, prisma } = build();
    const created: any = await service.create(USER_A, { ...base, paymentMethod: PaymentMethod.CREDIT, cardId: CARD_A1 } as any);
    expect(prisma.transaction.create.mock.calls[0][0].data.cardId).toBe(CARD_A1);
    expect(created.cardName).toBe('Nubank');
    expect(created.card).toBeUndefined();
    expect(created.cardId).toBe(CARD_A1);
  });

  it('sem cardId o lancamento nao escreve cardId e nao pega o lock', async () => {
    const { service, prisma } = build();
    const created: any = await service.create(USER_A, { ...base, paymentMethod: PaymentMethod.CREDIT } as any);
    expect(prisma.transaction.create.mock.calls[0][0].data.cardId).toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(created.cardName).toBeNull();
  });

  it('cardId com DEBIT ou PIX = 400 e nao cria', async () => {
    for (const pm of [PaymentMethod.DEBIT, PaymentMethod.PIX]) {
      const { service, prisma } = build();
      await expect(service.create(USER_A, { ...base, paymentMethod: pm, cardId: CARD_A1 } as any)).rejects.toThrow(CARD_NEEDS_CREDIT_MESSAGE);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    }
  });

  it('cartao alheio (B) e inexistente dao 404 com a mesma mensagem e nao criam', async () => {
    const { service, prisma } = build();
    const foreign = await service.create(USER_A, { ...base, paymentMethod: PaymentMethod.CREDIT, cardId: CARD_B1 } as any).catch((e) => e);
    const missing = await service.create(USER_A, { ...base, paymentMethod: PaymentMethod.CREDIT, cardId: MISSING } as any).catch((e) => e);
    expect(foreign).toBeInstanceOf(NotFoundException);
    expect(missing).toBeInstanceOf(NotFoundException);
    expect(foreign.message).toBe(CARD_NOT_FOUND_MESSAGE);
    expect(missing.message).toBe(foreign.message);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('cartao arquivado nao aceita lancamento novo (400)', async () => {
    const { service, prisma } = build();
    await expect(service.create(USER_A, { ...base, paymentMethod: PaymentMethod.CREDIT, cardId: CARD_A2 } as any)).rejects.toThrow(CARD_ARCHIVED_MESSAGE);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('usuario C sem cartao nao usa o cartao de A nem o de B', async () => {
    const { service } = build();
    await expect(service.create(USER_C, { ...base, paymentMethod: PaymentMethod.CREDIT, cardId: CARD_A1 } as any)).rejects.toThrow(NotFoundException);
    await expect(service.create(USER_C, { ...base, paymentMethod: PaymentMethod.CREDIT, cardId: CARD_B1 } as any)).rejects.toThrow(NotFoundException);
  });

  describe('edicao', () => {
    it('lancamento com cartao arquivado gravado: edicao sem cardId continua ok e nao mexe no cardId', async () => {
      const { service, prisma } = build({ id: 'tx-1', userId: USER_A, paymentMethod: PaymentMethod.CREDIT, cardId: CARD_A2 });
      await service.update(USER_A, 'tx-1', { description: 'Novo nome' } as any);
      const data = prisma.transaction.update.mock.calls[0][0].data;
      expect(data.cardId).toBeUndefined();
    });

    it('mandar o mesmo cartao arquivado que ja estava gravado tambem passa', async () => {
      const { service, prisma } = build({ id: 'tx-1', userId: USER_A, paymentMethod: PaymentMethod.CREDIT, cardId: CARD_A2 });
      await service.update(USER_A, 'tx-1', { cardId: CARD_A2 } as any);
      expect(prisma.transaction.update.mock.calls[0][0].data.cardId).toBeUndefined();
    });

    it('trocar para cartao arquivado diferente = 400', async () => {
      const { service, prisma } = build({ id: 'tx-1', userId: USER_A, paymentMethod: PaymentMethod.CREDIT, cardId: CARD_A1 });
      await expect(service.update(USER_A, 'tx-1', { cardId: CARD_A2 } as any)).rejects.toThrow(CARD_ARCHIVED_MESSAGE);
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('sair de CREDIT limpa o cardId', async () => {
      const { service, prisma } = build({ id: 'tx-1', userId: USER_A, paymentMethod: PaymentMethod.CREDIT, cardId: CARD_A1 });
      await service.update(USER_A, 'tx-1', { paymentMethod: PaymentMethod.PIX } as any);
      expect(prisma.transaction.update.mock.calls[0][0].data.cardId).toBeNull();
    });

    it('cardId null limpa o vinculo', async () => {
      const { service, prisma } = build({ id: 'tx-1', userId: USER_A, paymentMethod: PaymentMethod.CREDIT, cardId: CARD_A1 });
      await service.update(USER_A, 'tx-1', { cardId: null } as any);
      expect(prisma.transaction.update.mock.calls[0][0].data.cardId).toBeNull();
    });

    it('cardId de outro usuario na edicao = 404 e nao grava', async () => {
      const { service, prisma } = build({ id: 'tx-1', userId: USER_A, paymentMethod: PaymentMethod.CREDIT, cardId: null });
      await expect(service.update(USER_A, 'tx-1', { cardId: CARD_B1 } as any)).rejects.toThrow(NotFoundException);
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('cardId enviado com lancamento em PIX (sem trocar a forma) = 400', async () => {
      const { service, prisma } = build({ id: 'tx-1', userId: USER_A, paymentMethod: PaymentMethod.PIX, cardId: null });
      await expect(service.update(USER_A, 'tx-1', { cardId: CARD_A1 } as any)).rejects.toThrow(CARD_NEEDS_CREDIT_MESSAGE);
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('edicao de lancamento de outro usuario continua 404 (sem vazar o cartao)', async () => {
      const { service } = build(null);
      await expect(service.update(USER_B, 'tx-1', { cardId: CARD_B1 } as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listagem filtrada por cartao', () => {
    it('cartao alheio no filtro = 404 e nem consulta os lancamentos', async () => {
      const { service, prisma } = build();
      await expect(service.list(USER_A, { cardId: CARD_B1 } as any)).rejects.toThrow(NotFoundException);
      expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    });

    it('cartao proprio filtra por cardId', async () => {
      const { service, prisma } = build();
      await service.list(USER_A, { cardId: CARD_A1 } as any);
      expect(prisma.transaction.findMany.mock.calls[0][0].where.cardId).toBe(CARD_A1);
    });

    it('cartao inexistente no filtro = mesmo 404', async () => {
      const { service } = build();
      const error = await service.list(USER_A, { cardId: MISSING } as any).catch((e) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(CARD_NOT_FOUND_MESSAGE);
    });

    it('sem filtro nao coloca cardId no where', async () => {
      const { service, prisma } = build();
      await service.list(USER_A, {} as any);
      expect(prisma.transaction.findMany.mock.calls[0][0].where.cardId).toBeUndefined();
    });
  });
});
