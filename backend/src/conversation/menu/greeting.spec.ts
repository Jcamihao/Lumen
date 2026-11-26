import { greetingFor } from './greeting';

describe('greetingFor', () => {
  it.each([
    ['2026-11-26T08:00:00-03:00', 'Bom dia'],
    ['2026-11-26T05:00:00-03:00', 'Bom dia'],
    ['2026-11-26T11:59:00-03:00', 'Bom dia'],
    ['2026-11-26T12:00:00-03:00', 'Boa tarde'],
    ['2026-11-26T17:59:00-03:00', 'Boa tarde'],
    ['2026-11-26T18:00:00-03:00', 'Boa noite'],
    ['2026-11-26T23:30:00-03:00', 'Boa noite'],
    ['2026-11-26T04:59:00-03:00', 'Boa noite'],
  ])('%s em São Paulo -> %s', (iso, expected) => {
    expect(greetingFor(new Date(iso), 'America/Sao_Paulo')).toBe(expected);
  });

  it('usa o fuso do usuário, não o do servidor', () => {
    const instant = new Date('2026-11-26T12:00:00Z');
    expect(greetingFor(instant, 'Asia/Tokyo')).toBe('Boa noite');
    expect(greetingFor(instant, 'America/Sao_Paulo')).toBe('Bom dia');
  });

  it('fuso inválido cai em São Paulo', () => {
    expect(greetingFor(new Date('2026-11-26T13:00:00Z'), 'Mars/Base')).toBe('Bom dia');
  });
});
