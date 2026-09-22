import { monthStart, monthsBetween, nextMonthStart } from './envelope.util';
import { utcDate } from '../recurring-transactions/recurrence.util';

const iso = (date: Date) => date.toISOString().slice(0, 10);

describe('envelope.util', () => {
  it('monthStart pega o dia 1 do mes, meia-noite UTC', () => {
    expect(iso(monthStart(utcDate(2026, 8, 21)))).toBe('2026-09-01');
    expect(iso(monthStart(utcDate(2026, 8, 1)))).toBe('2026-09-01');
  });

  it('nextMonthStart vira o ano corretamente', () => {
    expect(iso(nextMonthStart(utcDate(2026, 11, 15)))).toBe('2027-01-01');
  });

  it('monthsBetween lista cada mes uma vez, do inicio ao fim', () => {
    const months = monthsBetween(utcDate(2026, 6, 20), utcDate(2026, 8, 5));
    expect(months.map(iso)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
  });

  it('mesmo mes devolve so um item', () => {
    const months = monthsBetween(utcDate(2026, 8, 1), utcDate(2026, 8, 28));
    expect(months.map(iso)).toEqual(['2026-09-01']);
  });

  it('mes de fim antes do inicio nao gera nenhum (nao deveria acontecer, mas nao trava)', () => {
    expect(monthsBetween(utcDate(2026, 8, 1), utcDate(2026, 7, 1))).toHaveLength(0);
  });
});
