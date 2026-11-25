import { SENSITIVE_STEMS, TONE_TEXTS, ToneKind, ToneMoment } from './tone.texts';
import { hasSensitiveWord, toneKindFor, toneText, variantIndex } from './tone.service';

const EMOJI = /\p{Extended_Pictographic}/gu;
const MOMENTS: ToneMoment[] = ['rascunho', 'recibo'];
const KINDS: ToneKind[] = ['ALEGRE', 'CELEBRANDO', 'NEUTRO', 'ATENTO'];

function emojiCount(text: string): number {
  return (text.match(EMOJI) ?? []).length;
}

describe('toneKindFor', () => {
  it.each([
    ['RECEITA', 'ALEGRE'],
    ['GUARDAR', 'CELEBRANDO'],
    ['DESPESA', 'NEUTRO'],
    ['PARCELADO', 'ATENTO'],
  ] as const)('%s vira %s sem palavra sensivel', (subject, expected) => {
    expect(toneKindFor(subject, ['mercado', 'Alimentação'])).toBe(expected);
  });

  it.each(['RECEITA', 'GUARDAR', 'PARCELADO', 'DESPESA'] as const)('%s com palavra sensivel vira NEUTRO', (subject) => {
    expect(toneKindFor(subject, ['remédio'])).toBe('NEUTRO');
    expect(toneKindFor(subject, ['freela', 'Saúde'])).toBe('NEUTRO');
  });

  it('ignora caixa e acento na palavra sensivel', () => {
    expect(hasSensitiveWord(['SAÚDE'])).toBe(true);
    expect(hasSensitiveWord(['Hospital da cidade'])).toBe(true);
    expect(hasSensitiveWord(['multa de trânsito'])).toBe(true);
  });

  it('nao confunde palavra comum com sensivel', () => {
    expect(hasSensitiveWord(['mercado', 'padaria', 'salário', 'freela'])).toBe(false);
  });

  it('cada radical sensivel casa no inicio de uma palavra', () => {
    for (const stem of SENSITIVE_STEMS) {
      expect(hasSensitiveWord([stem])).toBe(true);
    }
  });
});

describe('variantIndex', () => {
  it('mesmo messageId, mesmo indice (deterministico)', () => {
    expect(variantIndex('msg-42', 3)).toBe(variantIndex('msg-42', 3));
    expect(variantIndex('msg-42', 3)).toBe(variantIndex('msg-42', 3));
  });

  it('indice sempre dentro do tamanho da lista', () => {
    for (let index = 0; index < 500; index += 1) {
      const value = variantIndex(`id-${index}`, 4);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(4);
    }
  });

  it('distribuicao cobre todas as variantes em N ids', () => {
    const seen = new Set<number>();
    for (let index = 0; index < 300; index += 1) {
      seen.add(variantIndex(`wa-${index}`, 3));
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('seed vazia (rascunho antigo) cai sempre na mesma variante', () => {
    expect(variantIndex('', 3)).toBe(variantIndex('', 3));
  });
});

describe('toneText', () => {
  it('troca placeholders pelos valores e nao deixa chave sem preencher', () => {
    for (const kind of KINDS) {
      for (const moment of MOMENTS) {
        const values = { valor: 'V', descricao: 'D', meta: 'M', cartao: '', total: 'T', parcelas: 'P' };
        const text = toneText({ kind, moment, seed: 'x', values });
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('valor com cifrao e padrao especial entra literal', () => {
    const text = toneText({ kind: 'NEUTRO', moment: 'rascunho', seed: '', values: { valor: 'R$ $& $1', descricao: 'x' } });
    expect(text).toContain('R$ $& $1');
  });

  it('placeholder sem valor lanca erro (nao grava texto quebrado)', () => {
    expect(() => toneText({ kind: 'ATENTO', moment: 'recibo', seed: '', values: { descricao: 'x' } })).toThrow(
      'placeholder sem valor',
    );
  });
});

describe('textos fixos de tom', () => {
  it('ALEGRE e CELEBRANDO: exatamente 1 emoji em cada variante', () => {
    for (const kind of ['ALEGRE', 'CELEBRANDO'] as const) {
      for (const moment of MOMENTS) {
        for (const template of TONE_TEXTS[kind][moment]) {
          expect(emojiCount(template)).toBe(1);
        }
      }
    }
  });

  it('NEUTRO e ATENTO: nenhum emoji e nenhuma exclamacao festiva', () => {
    for (const kind of ['NEUTRO', 'ATENTO'] as const) {
      for (const moment of MOMENTS) {
        for (const template of TONE_TEXTS[kind][moment]) {
          expect(emojiCount(template)).toBe(0);
          expect(template).not.toContain('!');
        }
      }
    }
  });

  it('cada tipo tem de 3 a 4 variantes por momento', () => {
    for (const kind of KINDS) {
      for (const moment of MOMENTS) {
        const size = TONE_TEXTS[kind][moment].length;
        expect(size).toBeGreaterThanOrEqual(3);
        expect(size).toBeLessThanOrEqual(4);
      }
    }
  });
});
