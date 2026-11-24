import { formatReplyForTelegram, splitIntoParts, escapeHtml } from './telegram-format';
import { maskChatId } from './telegram-mask';

describe('formato da resposta para o Telegram (D4)', () => {
  it('rascunho com rows vira linhas em negrito + teclado com os quickReplies', () => {
    const reply = formatReplyForTelegram({
      kind: 'CONFIRM_DRAFT',
      state: 'AWAITING_CONFIRMATION',
      text: 'Para gravar: R$ 50,00 · mercado.',
      draft: {
        draftId: 'd1',
        draftVersion: 1,
        kind: 'TRANSACTION',
        title: 'Lancamento',
        type: 'EXPENSE',
        amount: 'R$ 50,00',
        description: null,
        category: null,
        date: null,
        paymentMethod: null,
        pendingField: null,
        rows: [{ label: 'Valor', value: 'R$ 50,00' }],
      },
      quickReplies: ['confirmar', 'cancelar'],
    } as never);

    expect(reply.parts[0]).toContain('<b>Valor:</b> R$ 50,00');
    expect(reply.keyboard).toEqual(['confirmar', 'cancelar']);
  });

  it('texto do motor que ja e o cartao completo nao e repetido; teclado permanece', () => {
    const reply = formatReplyForTelegram({
      kind: 'CONFIRM_DRAFT',
      state: 'AWAITING_CONFIRMATION',
      text: 'Confirmar lancamento? Responda "confirmar" ou "cancelar".',
      draft: { rows: [{ label: 'Valor', value: 'R$ 50,00' }] },
      quickReplies: ['confirmar', 'cancelar'],
    } as never);

    expect(reply.parts[0]).toBe('Confirmar lancamento? Responda "confirmar" ou "cancelar".');
    expect(reply.keyboard).toEqual(['confirmar', 'cancelar']);
  });

  it('teclado do limpar e do apagar passam iguais aos do motor (8a/8d)', () => {
    const base = { kind: 'CONFIRM_DRAFT', state: 'AWAITING_CONFIRMATION', text: 'x', draft: undefined };
    expect(formatReplyForTelegram({ ...base, quickReplies: ['limpar', 'cancelar'] } as never).keyboard).toEqual(['limpar', 'cancelar']);
    expect(formatReplyForTelegram({ ...base, quickReplies: ['apagar', 'cancelar'] } as never).keyboard).toEqual(['apagar', 'cancelar']);
  });

  it('sem quickReplies nao ha teclado; INFO simples e so o texto', () => {
    const reply = formatReplyForTelegram({ kind: 'INFO', state: 'IDLE', text: 'Saldo: R$ 10,00' } as never);
    expect(reply.parts).toEqual(['Saldo: R$ 10,00']);
    expect(reply.keyboard).toBeUndefined();
  });

  it('HELP lista exemplos no texto, sem teclado', () => {
    const reply = formatReplyForTelegram({ kind: 'HELP', state: 'IDLE', text: 'Oi', quickReplies: ['saldo', '50 mercado'] } as never);
    expect(reply.parts[0]).toContain('Exemplos: saldo | 50 mercado');
    expect(reply.keyboard).toBeUndefined();
  });

  it('HTML e sempre escapado: texto de usuario nao vira tag nem come&', () => {
    expect(escapeHtml('<script>&')).toBe('&lt;script&gt;&amp;');
    const reply = formatReplyForTelegram({
      kind: 'DONE',
      state: 'IDLE',
      text: 'Lancado: <b>mercado</b> & afins',
    } as never);
    expect(reply.parts[0]).toBe('Lancado: &lt;b&gt;mercado&lt;/b&gt; &amp; afins');
  });

  it('texto gigante divide em partes e termina em reticencias', () => {
    const reply = formatReplyForTelegram({ kind: 'INFO', state: 'IDLE', text: 'a'.repeat(15000) } as never);
    expect(reply.parts.length).toBe(4);
    expect(reply.parts[0].length).toBeLessThanOrEqual(3500);
    expect(reply.parts.at(-1)?.endsWith('…')).toBe(true);
  });

  it('corte prefere quebra de linha', () => {
    const text = `${'x'.repeat(3000)}\n${'y'.repeat(2000)}`;
    const parts = splitIntoParts(text);
    expect(parts[0]).toBe('x'.repeat(3000));
    expect(parts[1]).toBe('y'.repeat(2000));
  });

  it('quebra na posicao zero nao e usada como corte (parte vazia custaria um envio)', () => {
    const text = `\n${'a'.repeat(4000)}`;
    const parts = splitIntoParts(text);
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe(text.slice(0, 3500));
    expect(parts[1]).toBe('a'.repeat(501));
  });
});

describe('mascara do chat.id (D1/D7)', () => {
  it('mantem dois digitos de cada ponta', () => {
    expect(maskChatId('987654321')).toBe('98•••••21');
    expect(maskChatId(987654321n)).toBe('98•••••21');
  });

  it('curto ou nao-numerico nao mostra nada', () => {
    expect(maskChatId('1234')).toBe('••••');
    expect(maskChatId('ab-cd-ef')).toBe('••••');
  });
});
