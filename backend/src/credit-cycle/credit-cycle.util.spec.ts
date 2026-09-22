import { creditCycleBounds } from './credit-cycle.util';
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
