import { dayOnlyParts, formatDayLabel, formatLocalDateLabel } from './date.utils';

describe('date utils — datas "so dia"', () => {
  it('meia-noite UTC mostra o mesmo dia, sem recuar por causa do fuso', () => {
    // A API devolve datas de lancamento/prazo assim; no Brasil (UTC-3) isto virava 20/09.
    expect(formatDayLabel('2026-09-21T00:00:00.000Z')).toBe('21/09/2026');
    expect(formatLocalDateLabel('2026-09-21T00:00:00.000Z')).toBe('21/09/2026');
  });

  it('primeiro dia do mes e de ano nao voltam para o mes/ano anterior', () => {
    expect(formatDayLabel('2026-10-01T00:00:00.000Z')).toBe('01/10/2026');
    expect(formatDayLabel('2027-01-01T00:00:00.000Z')).toBe('01/01/2027');
  });

  it('data pura (AAAA-MM-DD) tambem funciona', () => {
    expect(formatDayLabel('2026-09-21')).toBe('21/09/2026');
  });

  it('respeita o formato pedido (dia e mes abreviado)', () => {
    expect(formatDayLabel('2026-09-21T00:00:00.000Z', { day: '2-digit', month: 'short' })).toMatch(/^21 de set\.?$/);
  });

  it('instante de verdade (com hora) continua no fuso local', () => {
    const instant = '2026-09-21T15:30:00.000Z';

    expect(formatDayLabel(instant)).toBe(
      new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(instant)),
    );
  });

  it('valor vazio devolve texto vazio', () => {
    expect(formatDayLabel(null)).toBe('');
    expect(formatDayLabel(undefined)).toBe('');
    expect(formatDayLabel('')).toBe('');
  });

  it('dayOnlyParts reconhece so "dia" e meia-noite UTC', () => {
    expect(dayOnlyParts('2026-09-21')).toEqual({ year: 2026, month: 9, day: 21 });
    expect(dayOnlyParts('2026-09-21T00:00:00.000Z')).toEqual({ year: 2026, month: 9, day: 21 });
    expect(dayOnlyParts('2026-09-21T00:00:00Z')).toEqual({ year: 2026, month: 9, day: 21 });
    expect(dayOnlyParts('2026-09-21T03:00:00.000Z')).toBeNull();
    expect(dayOnlyParts('lixo')).toBeNull();
  });
});
