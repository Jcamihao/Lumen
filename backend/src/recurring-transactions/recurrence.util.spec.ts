import { RecurrenceFrequency } from '@prisma/client';
import {
  firstOccurrenceOnOrAfter,
  localToday,
  nextOccurrence,
  utcDate,
} from './recurrence.util';

const iso = (date: Date) => date.toISOString().slice(0, 10);
const { WEEKLY, MONTHLY, YEARLY } = RecurrenceFrequency;

describe('localToday', () => {
  it('usa o dia do fuso do usuario, nao o UTC', () => {
    // 02:30 UTC de 21/09 ainda e 23:30 de 20/09 em Sao Paulo (UTC-3).
    const now = new Date('2026-09-21T02:30:00.000Z');

    expect(iso(localToday(now, 'America/Sao_Paulo'))).toBe('2026-09-20');
    expect(iso(localToday(now, 'UTC'))).toBe('2026-09-21');
    expect(iso(localToday(now, 'Asia/Tokyo'))).toBe('2026-09-21');
  });

  it('devolve meia-noite UTC', () => {
    const today = localToday(new Date('2026-09-21T15:45:10.000Z'), 'America/Sao_Paulo');

    expect(today.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('cai em UTC quando o fuso e invalido, sem lancar erro', () => {
    expect(iso(localToday(new Date('2026-09-21T02:30:00.000Z'), 'Nao/Existe'))).toBe('2026-09-21');
  });
});

describe('nextOccurrence', () => {
  it('semanal soma 7 dias', () => {
    expect(iso(nextOccurrence(utcDate(2026, 8, 28), WEEKLY, 28))).toBe('2026-10-05');
  });

  it('mensal mantem o dia no mes seguinte', () => {
    expect(iso(nextOccurrence(utcDate(2026, 8, 5), MONTHLY, 5))).toBe('2026-10-05');
  });

  it('mensal vira o ano em dezembro', () => {
    expect(iso(nextOccurrence(utcDate(2026, 11, 15), MONTHLY, 15))).toBe('2027-01-15');
  });

  it('mensal do dia 31 usa o ultimo dia dos meses curtos e volta ao 31', () => {
    const jan = utcDate(2026, 0, 31);
    const feb = nextOccurrence(jan, MONTHLY, 31);
    const mar = nextOccurrence(feb, MONTHLY, 31);
    const apr = nextOccurrence(mar, MONTHLY, 31);

    expect([feb, mar, apr].map(iso)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('mensal do dia 31 usa 29/02 em ano bissexto', () => {
    expect(iso(nextOccurrence(utcDate(2028, 0, 31), MONTHLY, 31))).toBe('2028-02-29');
  });

  it('anual mantem mes e dia; 29/02 vira 28/02 em ano comum e volta em ano bissexto', () => {
    const leap = utcDate(2028, 1, 29);
    const common = nextOccurrence(leap, YEARLY, 29);
    const back = nextOccurrence(nextOccurrence(common, YEARLY, 29), YEARLY, 29);

    expect(iso(common)).toBe('2029-02-28');
    expect(iso(back)).toBe('2031-02-28');
    expect(iso(nextOccurrence(utcDate(2031, 1, 28), YEARLY, 29))).toBe('2032-02-29');
  });

  it('nao muda com o fuso do processo (so UTC)', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/Sao_Paulo';
    try {
      expect(iso(nextOccurrence(utcDate(2026, 8, 1), MONTHLY, 1))).toBe('2026-10-01');
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('firstOccurrenceOnOrAfter', () => {
  it('mantem a data quando ela ja e hoje ou futura', () => {
    const due = utcDate(2026, 8, 25);

    expect(iso(firstOccurrenceOnOrAfter(due, utcDate(2026, 8, 20), MONTHLY, 25))).toBe('2026-09-25');
    expect(iso(firstOccurrenceOnOrAfter(due, utcDate(2026, 8, 25), MONTHLY, 25))).toBe('2026-09-25');
  });

  it('pula os vencimentos perdidos ate o primeiro que ainda vem', () => {
    // Pausada desde junho, retomada em 21/09: o proximo dia 5 e 05/10.
    expect(iso(firstOccurrenceOnOrAfter(utcDate(2026, 5, 5), utcDate(2026, 8, 21), MONTHLY, 5))).toBe(
      '2026-10-05',
    );
  });

  it('funciona para semanal', () => {
    expect(iso(firstOccurrenceOnOrAfter(utcDate(2026, 8, 1), utcDate(2026, 8, 21), WEEKLY, 1))).toBe(
      '2026-09-22',
    );
  });
});
