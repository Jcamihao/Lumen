import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import {
  CARD_ARCHIVED_MESSAGE,
  CARD_NEEDS_CREDIT_MESSAGE,
  CARD_NOT_FOUND_MESSAGE,
  lockForCardLink,
  resolveCardForCreate,
  resolveCardForUpdate,
  withCardGuard,
} from './card-link';

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

describe('card-link: regras de vinculo de cartao', () => {
  const build = () => {
    const cards = fakeCards();
    const tx: any = { creditCard: cards.creditCard, $queryRaw: jest.fn().mockResolvedValue([]) };
    return { tx, cards };
  };

  describe('criacao (resolveCardForCreate)', () => {
    it('sem cardId nao toca no cartao e devolve undefined', async () => {
      const { tx, cards } = build();
      expect(await resolveCardForCreate(tx, USER_A, undefined, PaymentMethod.CREDIT)).toBeUndefined();
      expect(await resolveCardForCreate(tx, USER_A, null, PaymentMethod.CREDIT)).toBeUndefined();
      expect(cards.creditCard.findFirst).not.toHaveBeenCalled();
    });

    it('cardId com DEBIT, PIX ou sem forma de pagamento = 400 claro', async () => {
      const { tx } = build();
      for (const pm of [PaymentMethod.DEBIT, PaymentMethod.PIX, null, undefined]) {
        await expect(resolveCardForCreate(tx, USER_A, CARD_A1, pm)).rejects.toThrow(BadRequestException);
      }
      await expect(resolveCardForCreate(tx, USER_A, CARD_A1, PaymentMethod.PIX)).rejects.toThrow(CARD_NEEDS_CREDIT_MESSAGE);
    });

    it('cartao proprio ativo com CREDIT devolve o id', async () => {
      const { tx } = build();
      expect(await resolveCardForCreate(tx, USER_A, CARD_A1, PaymentMethod.CREDIT)).toBe(CARD_A1);
    });

    it('cartao de outro usuario e id inexistente dao 404 com a MESMA mensagem', async () => {
      const { tx } = build();
      const foreign = await resolveCardForCreate(tx, USER_A, CARD_B1, PaymentMethod.CREDIT).catch((e) => e);
      const missing = await resolveCardForCreate(tx, USER_A, MISSING, PaymentMethod.CREDIT).catch((e) => e);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(missing).toBeInstanceOf(NotFoundException);
      expect(foreign.message).toBe(CARD_NOT_FOUND_MESSAGE);
      expect(missing.message).toBe(foreign.message);
    });

    it('cartao arquivado nao aceita novo lancamento (400)', async () => {
      const { tx } = build();
      await expect(resolveCardForCreate(tx, USER_A, CARD_A2, PaymentMethod.CREDIT)).rejects.toThrow(CARD_ARCHIVED_MESSAGE);
    });
  });

  describe('edicao (resolveCardForUpdate)', () => {
    const credit = { cardId: CARD_A1, paymentMethod: PaymentMethod.CREDIT };

    it('sem nada sobre cartao no dto nao mexe em cardId', async () => {
      const { tx } = build();
      expect(await resolveCardForUpdate(tx, USER_A, credit, { description: 'x' } as any)).toEqual({});
    });

    it('sair de CREDIT limpa o cardId gravado', async () => {
      const { tx } = build();
      expect(await resolveCardForUpdate(tx, USER_A, credit, { paymentMethod: PaymentMethod.PIX })).toEqual({ cardId: null });
      expect(await resolveCardForUpdate(tx, USER_A, credit, { paymentMethod: null })).toEqual({ cardId: null });
    });

    it('sair de CREDIT sem cardId gravado nao escreve nada', async () => {
      const { tx } = build();
      const pix = { cardId: null, paymentMethod: PaymentMethod.PIX };
      expect(await resolveCardForUpdate(tx, USER_A, pix, { description: 'x' } as any)).toEqual({});
    });

    it('cardId enviado fora de CREDIT = 400, mesmo que o cartao exista', async () => {
      const { tx } = build();
      const pix = { cardId: null, paymentMethod: PaymentMethod.PIX };
      await expect(resolveCardForUpdate(tx, USER_A, pix, { cardId: CARD_A1 })).rejects.toThrow(CARD_NEEDS_CREDIT_MESSAGE);
    });

    it('cardId null limpa o vinculo', async () => {
      const { tx } = build();
      expect(await resolveCardForUpdate(tx, USER_A, credit, { cardId: null })).toEqual({ cardId: null });
    });

    it('cartao ja gravado que depois foi arquivado continua valido (nao mexe no historico)', async () => {
      const { tx } = build();
      const stored = { cardId: CARD_A2, paymentMethod: PaymentMethod.CREDIT };
      expect(await resolveCardForUpdate(tx, USER_A, stored, { cardId: CARD_A2 })).toEqual({});
      expect(await resolveCardForUpdate(tx, USER_A, stored, { description: 'x' } as any)).toEqual({});
    });

    it('trocar para cartao arquivado (vinculo novo) = 400', async () => {
      const { tx } = build();
      await expect(resolveCardForUpdate(tx, USER_A, credit, { cardId: CARD_A2 })).rejects.toThrow(CARD_ARCHIVED_MESSAGE);
    });

    it('trocar para cartao alheio = 404 e nao grava', async () => {
      const { tx } = build();
      await expect(resolveCardForUpdate(tx, USER_A, credit, { cardId: CARD_B1 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('lock e guarda de escrita', () => {
    it('lockForCardLink pega o lock do User so quando ha cardId', async () => {
      const { tx } = build();
      await lockForCardLink(tx, USER_A, undefined);
      await lockForCardLink(tx, USER_A, null);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      await lockForCardLink(tx, USER_A, CARD_A1);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('withCardGuard sem cardId roda direto no cliente, sem transacao', async () => {
      const prisma: any = { $transaction: jest.fn() };
      const fn = jest.fn().mockResolvedValue('ok');
      expect(await withCardGuard(prisma, USER_A, undefined, fn)).toBe('ok');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(fn).toHaveBeenCalledWith(prisma);
    });

    it('withCardGuard com cardId roda em transacao, com o lock do User antes do callback', async () => {
      const { tx } = build();
      const prisma: any = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
      const order: string[] = [];
      tx.$queryRaw.mockImplementation(async () => order.push('lock'));
      await withCardGuard(prisma, USER_A, CARD_A1, async () => {
        order.push('write');
        return 1;
      });
      expect(order).toEqual(['lock', 'write']);
    });
  });
});
