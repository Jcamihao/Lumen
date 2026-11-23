import { TransactionType } from '@prisma/client';
import { cardSpendWhere } from './credit-cycle.util';

/**
 * Avaliador minimo do where do Prisma usado pelo filtro de gasto: serve para
 * provar QUEM entra no total de cada cartao, nao so o formato do filtro.
 */
type Row = { userId: string; type: string; date: Date; paymentMethod: string | null; cardId: string | null; amount: number };

const matches = (row: Row, where: any): boolean => {
  if (where.OR && !where.OR.some((clause: any) => matches(row, clause))) return false;
  for (const [key, value] of Object.entries(where)) {
    if (key === 'OR') continue;
    if (key === 'date') {
      const v = value as { gte: Date; lte: Date };
      if (row.date < v.gte || row.date > v.lte) return false;
    } else if (value === null) {
      if (row[key as keyof Row] !== null) return false;
    } else if (row[key as keyof Row] !== value) {
      return false;
    }
  }
  return true;
};

const start = new Date('2026-10-06T00:00:00.000Z');
const end = new Date('2026-11-05T00:00:00.000Z');
const inCycle = new Date('2026-10-20T00:00:00.000Z');
const U = 'user-a';
const DEFAULT = { id: 'card-default', isDefault: true, countAllPayments: false };
const SECOND = { id: 'card-second', isDefault: false, countAllPayments: false };
const DEFAULT_ALL = { id: 'card-default', isDefault: true, countAllPayments: true };

const ledger: Row[] = [
  { userId: U, type: 'EXPENSE', date: inCycle, paymentMethod: 'CREDIT', cardId: 'card-default', amount: 10 },
  { userId: U, type: 'EXPENSE', date: inCycle, paymentMethod: 'CREDIT', cardId: null, amount: 20 },
  { userId: U, type: 'EXPENSE', date: inCycle, paymentMethod: 'CREDIT', cardId: 'card-second', amount: 40 },
  { userId: U, type: 'EXPENSE', date: inCycle, paymentMethod: 'PIX', cardId: null, amount: 80 },
  { userId: U, type: 'EXPENSE', date: inCycle, paymentMethod: 'DEBIT', cardId: null, amount: 160 },
  { userId: U, type: 'INCOME', date: inCycle, paymentMethod: 'CREDIT', cardId: null, amount: 320 },
  { userId: U, type: 'EXPENSE', date: new Date('2026-09-01T00:00:00.000Z'), paymentMethod: 'CREDIT', cardId: null, amount: 640 },
];

const total = (card: { id: string; isDefault: boolean; countAllPayments: boolean }) =>
  ledger
    .filter((row) => matches(row, cardSpendWhere(U, card, start, end)))
    .reduce((sum, row) => sum + row.amount, 0);

describe('cardSpendWhere: quem entra no gasto de cada cartao (contrato item 9, secao 4.3 e 4.4)', () => {
  it('padrao soma CREDIT com o proprio cardId e CREDIT sem cartao (lancamentos antigos)', () => {
    expect(total(DEFAULT)).toBe(10 + 20);
  });

  it('padrao NAO soma o CREDIT do cartao secundario', () => {
    const counted = ledger.filter((row) => matches(row, cardSpendWhere(U, DEFAULT, start, end)));
    expect(counted.some((row) => row.cardId === 'card-second')).toBe(false);
  });

  it('cartao secundario soma so o proprio CREDIT (nao o nulo, nao o padrao)', () => {
    expect(total(SECOND)).toBe(40);
  });

  it('PIX e debito nunca entram em cartao que nao soma tudo', () => {
    expect(total(DEFAULT)).toBe(30);
    expect(total(SECOND)).toBe(40);
  });

  it('padrao com countAllPayments soma toda EXPENSE do ciclo, de qualquer cartao, PIX e debito', () => {
    expect(total(DEFAULT_ALL)).toBe(10 + 20 + 40 + 80 + 160);
  });

  it('receita e gasto fora do ciclo nunca entram, mesmo somando tudo', () => {
    // 320 (receita) e 640 (setembro) ficam de fora: 10+20+40+80+160.
    expect(total(DEFAULT_ALL)).toBe(310);
  });

  it('countAllPayments em cartao nao padrao nao libera o filtro (invariante do contrato)', () => {
    const secondAll = { id: 'card-second', isDefault: false, countAllPayments: true };
    expect(total(secondAll)).toBe(40);
  });
});
