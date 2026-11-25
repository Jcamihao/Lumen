import { NotFoundException } from '@nestjs/common';
import { PaymentMethod, TransactionType } from '@prisma/client';
import { CARD_NOT_FOUND_MESSAGE } from '../credit-cards/card-link';
import { TransactionsService } from './transactions.service';

/*
 * Filtro de listagem por cartao, com o where avaliado em memoria (AND implicito entre campos,
 * OR por array, null = IS NULL). Cobre a regra nova: o padrao inclui CREDIT sem cartao; o
 * secundario so o proprio cardId; cartao alheio 404; userId sempre no where.
 */

const USER_A = 'user-a';
const USER_B = 'user-b';
const CARD_A1 = '11111111-1111-4111-8111-111111111111'; // A, padrao
const CARD_A2 = '22222222-2222-4222-8222-222222222222'; // A, secundario
const CARD_B1 = '33333333-3333-4333-8333-333333333333'; // B, padrao
const MISSING = '44444444-4444-4444-8444-444444444444';

const cards = [
  { id: CARD_A1, userId: USER_A, name: 'Nubank', isDefault: true, archivedAt: null },
  { id: CARD_A2, userId: USER_A, name: 'Inter', isDefault: false, archivedAt: null },
  { id: CARD_B1, userId: USER_B, name: 'Itau', isDefault: true, archivedAt: null },
];

const row = (
  id: string,
  userId: string,
  paymentMethod: PaymentMethod | null,
  cardId: string | null,
  type: TransactionType = TransactionType.EXPENSE,
) => ({
  id, userId, type, paymentMethod, cardId, description: id, amount: 1,
  date: new Date('2026-10-05T00:00:00Z'), createdAt: new Date('2026-10-05T00:00:00Z'),
  categoryId: null, envelopeId: null, card: null,
});

const transactions = [
  row('a-padrao', USER_A, PaymentMethod.CREDIT, CARD_A1),
  row('a-antigo-credit', USER_A, PaymentMethod.CREDIT, null), // CREDIT sem cartao: conta no padrao
  row('a-pix-nulo', USER_A, PaymentMethod.PIX, null),
  row('a-debit-nulo', USER_A, PaymentMethod.DEBIT, null),
  row('a-sem-forma', USER_A, null, null),
  row('a-receita', USER_A, null, null, TransactionType.INCOME),
  row('a-receita-credit', USER_A, PaymentMethod.CREDIT, null, TransactionType.INCOME), // receita CREDIT sem cartao: fora do padrao
  row('a-secundario', USER_A, PaymentMethod.CREDIT, CARD_A2),
  row('b-antigo-credit', USER_B, PaymentMethod.CREDIT, null),
  row('b-padrao', USER_B, PaymentMethod.CREDIT, CARD_B1),
];

/** Avalia o where do Prisma no subconjunto usado pelo servico. */
const matches = (r: any, where: any): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'OR') return (cond as any[]).some((sub) => matches(r, sub));
    if (cond === null) return r[key] === null || r[key] === undefined;
    if (typeof cond === 'object') throw new Error(`operador nao suportado no teste: ${key}`);
    return r[key] === cond;
  });

const build = () => {
  const prisma: any = {
    creditCard: {
      findFirst: jest.fn(async ({ where }: any) => cards.find((c) => matches(c, where)) ?? null),
    },
    transaction: {
      findMany: jest.fn(async ({ where }: any) => transactions.filter((t) => matches(t, where))),
    },
  };
  const materializer = { materializeDue: jest.fn().mockResolvedValue(0) };
  const lifeEngine = { touchUserData: jest.fn().mockResolvedValue(undefined) };
  const service = new TransactionsService(prisma, lifeEngine as any, materializer as any, materializer as any);
  return { service, prisma };
};

const ids = (list: Array<{ id: string }>) => list.map((t) => t.id).sort();

describe('listagem por cartao: escopo do padrao e do secundario (isolamento A/B)', () => {
  it('padrao de A: inclui CREDIT sem cartao e o proprio cardId; nao inclui PIX/DEBIT/sem forma/receita nulos', async () => {
    const { service } = build();
    const list = await service.list(USER_A, { cardId: CARD_A1 } as any);
    expect(ids(list)).toEqual(['a-antigo-credit', 'a-padrao']);
  });

  it('padrao de A nao traz receita CREDIT sem cartao (so despesa entra no nulo)', async () => {
    const { service } = build();
    const list = await service.list(USER_A, { cardId: CARD_A1 } as any);
    expect(ids(list)).not.toContain('a-receita-credit');
  });

  it('padrao de A nao traz o cardId do secundario nem nenhum lancamento de B', async () => {
    const { service } = build();
    const list = await service.list(USER_A, { cardId: CARD_A1 } as any);
    expect(ids(list)).not.toContain('a-secundario');
    expect(ids(list).some((id) => id.startsWith('b-'))).toBe(false);
  });

  it('secundario de A: so o proprio cardId, sem os nulos CREDIT', async () => {
    const { service } = build();
    const list = await service.list(USER_A, { cardId: CARD_A2 } as any);
    expect(ids(list)).toEqual(['a-secundario']);
  });

  it('padrao de B: CREDIT sem cartao e o proprio cardId, nada de A', async () => {
    const { service } = build();
    const list = await service.list(USER_B, { cardId: CARD_B1 } as any);
    expect(ids(list)).toEqual(['b-antigo-credit', 'b-padrao']);
  });

  it('sem filtro de cartao: so os lancamentos do proprio usuario (A nunca ve B)', async () => {
    const { service } = build();
    const list = await service.list(USER_A, {} as any);
    expect(ids(list)).toEqual(transactions.filter((t) => t.userId === USER_A).map((t) => t.id).sort());
  });

  it('cartao de B no filtro de A = 404 e nem consulta lancamentos', async () => {
    const { service, prisma } = build();
    const error = await service.list(USER_A, { cardId: CARD_B1 } as any).catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(CARD_NOT_FOUND_MESSAGE);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it('cartao inexistente no filtro = mesmo 404 de alheio', async () => {
    const { service } = build();
    const error = await service.list(USER_A, { cardId: MISSING } as any).catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(CARD_NOT_FOUND_MESSAGE);
  });

  it('userId fica no where como AND (fora do OR)', async () => {
    const { service, prisma } = build();
    await service.list(USER_A, { cardId: CARD_A1 } as any);
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe(USER_A);
    expect(Array.isArray(where.OR)).toBe(true);
  });
});
