import { cardScopeWhere, cardSpendWhere, creditCycleBounds } from './credit-cycle.util';
import { utcDate } from '../recurring-transactions/recurrence.util';

const iso = (date: Date) => date.toISOString().slice(0, 10);
const bounds = (year: number, monthIndex: number, day: number, closingDay: number) => {
  const { start, end } = creditCycleBounds(utcDate(year, monthIndex, day), closingDay);
  return { start: iso(start), end: iso(end) };
};

describe('creditCycleBounds', () => {
  it('compra antes do fechamento entra no ciclo que fecha este mes', () => {
    // Fechamento dia 5; compra em 03/09 -> fatura que fecha 05/09.
    expect(bounds(2026, 8, 3, 5)).toEqual({ start: '2026-08-06', end: '2026-09-05' });
  });

  it('compra depois do fechamento entra no ciclo que fecha mes que vem', () => {
    // Compra em 10/09 -> fatura que fecha 05/10 (o exemplo dado ao usuario).
    expect(bounds(2026, 8, 10, 5)).toEqual({ start: '2026-09-06', end: '2026-10-05' });
  });

  it('compra NO dia do fechamento ainda entra no ciclo que fecha hoje', () => {
    expect(bounds(2026, 8, 5, 5)).toEqual({ start: '2026-08-06', end: '2026-09-05' });
  });

  it('fechamento em mes curto (28/29 de fevereiro) e clampado, e volta ao 31 depois', () => {
    // Fechamento dia 31, hoje 15/02/2027 (nao bissexto): fecha 28/02 (o ciclo
    // anterior fechou em 31/01 — mes cheio —, entao o novo comeca em 01/02).
    expect(bounds(2027, 1, 15, 31)).toEqual({ start: '2027-02-01', end: '2027-02-28' });
    // Mesma config em marco: fecha 31/03 de novo, comecando logo apos o 28/02.
    expect(bounds(2027, 2, 15, 31)).toEqual({ start: '2027-03-01', end: '2027-03-31' });
  });

  it('fechamento dia 31 em ano bissexto usa 29/02', () => {
    expect(bounds(2028, 1, 15, 31)).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('vira o ano corretamente (fechamento no inicio de janeiro)', () => {
    // Hoje 03/01/2027, fechamento dia 5: o ciclo anterior fechou em dezembro/2026.
    expect(bounds(2027, 0, 3, 5)).toEqual({ start: '2026-12-06', end: '2027-01-05' });
  });

  it('fechamento dia 1: o ciclo cobre praticamente o mes inteiro', () => {
    expect(bounds(2026, 8, 15, 1)).toEqual({ start: '2026-09-02', end: '2026-10-01' });
  });

  it('nao muda com o fuso do processo (so UTC)', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/Sao_Paulo';
    try {
      expect(bounds(2026, 8, 10, 5)).toEqual({ start: '2026-09-06', end: '2026-10-05' });
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('cardScopeWhere / cardSpendWhere (escopo de cartao, listagem e ciclo)', () => {
  const start = utcDate(2026, 9, 1);
  const end = utcDate(2026, 9, 31);

  it('padrao: cardId dele ou DESPESA CREDIT sem cartao (receita CREDIT sem cartao nao entra)', () => {
    expect(cardScopeWhere({ id: 'c1', isDefault: true })).toEqual({
      OR: [{ cardId: 'c1' }, { cardId: null, paymentMethod: 'CREDIT', type: 'EXPENSE' }],
    });
  });

  it('secundario: so o proprio cardId, sem nulos', () => {
    expect(cardScopeWhere({ id: 'c2', isDefault: false })).toEqual({ cardId: 'c2' });
  });

  it('gasto do padrao com countAllPayments: toda EXPENSE do usuario, sem filtro de forma ou cartao', () => {
    expect(cardSpendWhere('u1', { id: 'c1', isDefault: true, countAllPayments: true }, start, end)).toEqual({
      userId: 'u1', type: 'EXPENSE', date: { gte: start, lte: end },
    });
  });

  it('gasto do padrao sem countAllPayments: CREDIT + escopo do padrao', () => {
    expect(cardSpendWhere('u1', { id: 'c1', isDefault: true, countAllPayments: false }, start, end)).toEqual({
      userId: 'u1', type: 'EXPENSE', date: { gte: start, lte: end }, paymentMethod: 'CREDIT',
      OR: [{ cardId: 'c1' }, { cardId: null, paymentMethod: 'CREDIT', type: 'EXPENSE' }],
    });
  });

  it('gasto do secundario: CREDIT + so o cardId dele', () => {
    expect(cardSpendWhere('u1', { id: 'c2', isDefault: false, countAllPayments: true }, start, end)).toEqual({
      userId: 'u1', type: 'EXPENSE', date: { gte: start, lte: end }, paymentMethod: 'CREDIT', cardId: 'c2',
    });
  });
});
