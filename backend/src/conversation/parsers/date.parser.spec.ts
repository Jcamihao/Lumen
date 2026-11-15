import { addDaysYmd, extractDate, parseDateToken } from './date.parser';

const TODAY = '2026-11-15';

describe('date.parser', () => {
  it('hoje, ontem e anteontem', () => {
    expect(parseDateToken('hoje', TODAY)).toEqual({ kind: 'DATE', ymd: '2026-11-15' });
    expect(parseDateToken('ontem', TODAY)).toEqual({ kind: 'DATE', ymd: '2026-11-14' });
    expect(parseDateToken('anteontem', TODAY)).toEqual({ kind: 'DATE', ymd: '2026-11-13' });
    expect(parseDateToken('Ontem!', TODAY)).toEqual({ kind: 'DATE', ymd: '2026-11-14' });
  });

  it('dd/mm usa o ano de hoje', () => {
    expect(parseDateToken('10/11', TODAY)).toEqual({ kind: 'DATE', ymd: '2026-11-10' });
    expect(parseDateToken('1/3', TODAY)).toEqual({ kind: 'DATE', ymd: '2026-03-01' });
  });

  it('dd/mm/aaaa', () => {
    expect(parseDateToken('01/03/2025', TODAY)).toEqual({ kind: 'DATE', ymd: '2025-03-01' });
  });

  it('data inexistente e invalida', () => {
    expect(parseDateToken('31/02', TODAY)).toEqual({ kind: 'INVALID' });
    expect(parseDateToken('29/02/2026', TODAY)).toEqual({ kind: 'INVALID' });
    expect(parseDateToken('13/13', TODAY)).toEqual({ kind: 'INVALID' });
  });

  it('palavra que nao e data devolve null', () => {
    expect(parseDateToken('mercado', TODAY)).toBeNull();
  });

  it('sem data nos tokens usa hoje e mantem o resto', () => {
    expect(extractDate(['mercado', 'grande'], TODAY)).toEqual({
      ymd: TODAY,
      rest: ['mercado', 'grande'],
      invalid: false,
    });
  });

  it('remove a palavra de data do resto', () => {
    expect(extractDate(['mercado', 'ontem'], TODAY)).toEqual({
      ymd: '2026-11-14',
      rest: ['mercado'],
      invalid: false,
    });
  });

  it('marca invalid quando a data nao existe', () => {
    expect(extractDate(['mercado', '31/02'], TODAY).invalid).toBe(true);
  });

  it('soma dias sem depender do fuso', () => {
    expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
  });
});
