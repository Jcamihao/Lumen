import { escapeHtml, formatReplyForTelegram, menuRows, nodeIdFromCallback, splitIntoParts } from './telegram-format';
import { maskChatId } from './telegram-mask';

const draftReply = {
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
};

describe('formato da resposta para o Telegram (D4)', () => {
  it('rascunho com rows vira linhas em negrito + teclado com os quickReplies', () => {
    const reply = formatReplyForTelegram({
      kind: 'CONFIRM_DRAFT',
      state: 'AWAITING_CONFIRMATION',
      text: 'Para gravar: R$ 50,00 · mercado.',
      draft: draftReply,
      quickReplies: ['confirmar', 'cancelar'],
    } as never);

    expect(reply.parts[0]).toContain('<b>Valor:</b> R$ 50,00');
    expect(reply.markup).toEqual({ kind: 'confirm', labels: ['confirmar', 'cancelar'] });
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
    expect(reply.markup).toEqual({ kind: 'confirm', labels: ['confirmar', 'cancelar'] });
  });

  it('teclado do limpar e do apagar passam iguais aos do motor (8a/8d)', () => {
    const base = { kind: 'CONFIRM_DRAFT', state: 'AWAITING_CONFIRMATION', text: 'x', draft: undefined };
    expect(formatReplyForTelegram({ ...base, quickReplies: ['limpar', 'cancelar'] } as never).markup).toEqual({ kind: 'confirm', labels: ['limpar', 'cancelar'] });
    expect(formatReplyForTelegram({ ...base, quickReplies: ['apagar', 'cancelar'] } as never).markup).toEqual({ kind: 'confirm', labels: ['apagar', 'cancelar'] });
  });

  it('confirmacao sem quickReplies nao leva Confirmar/Cancelar: leva o botao fixo Menu', () => {
    const reply = formatReplyForTelegram({ kind: 'CONFIRM_DRAFT', state: 'AWAITING_CONFIRMATION', text: 'x' } as never);
    expect(reply.markup).toEqual({ kind: 'menu' });
  });

  it('INFO simples leva so o botao fixo Menu e o texto', () => {
    const reply = formatReplyForTelegram({ kind: 'INFO', state: 'IDLE', text: 'Saldo: R$ 10,00' } as never);
    expect(reply.parts).toEqual(['Saldo: R$ 10,00']);
    expect(reply.markup).toEqual({ kind: 'menu' });
  });

  it('HELP lista exemplos no texto e leva o botao fixo Menu', () => {
    const reply = formatReplyForTelegram({ kind: 'HELP', state: 'IDLE', text: 'Oi', quickReplies: ['saldo', '50 mercado'] } as never);
    expect(reply.parts[0]).toContain('Exemplos: saldo | 50 mercado');
    expect(reply.markup).toEqual({ kind: 'menu' });
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

describe('menu inline do Telegram (12.1b)', () => {
  const root = {
    nodeId: 'menu',
    title: 'Menu',
    options: [
      { id: 'inicio', label: 'Início' },
      { id: 'financas', label: 'Finanças' },
    ],
  };

  it('raiz: uma opcao por linha, sem Voltar nem Menu', () => {
    expect(menuRows(root)).toEqual([
      [{ text: 'Início', callback_data: 'm:inicio' }],
      [{ text: 'Finanças', callback_data: 'm:financas' }],
    ]);
  });

  it('submenu: ultima linha tem Voltar (pai) e Menu (topo)', () => {
    const area = { nodeId: 'financas', title: 'Finanças', options: [{ id: 'financas.saldo', label: 'Saldo' }], backId: 'menu', topId: 'menu' };
    expect(menuRows(area)).toEqual([
      [{ text: 'Saldo', callback_data: 'm:financas.saldo' }],
      [
        { text: 'Voltar', callback_data: 'm:menu' },
        { text: 'Menu', callback_data: 'm:menu' },
      ],
    ]);
  });

  it('limite de 100 botoes por teclado: a navegacao continua na ultima linha', () => {
    const options = Array.from({ length: 150 }, (_, index) => ({ id: `o${index}`, label: `Opcao ${index}` }));
    const rows = menuRows({ nodeId: 'financas', title: 'Grande', options, backId: 'menu', topId: 'menu' });
    const buttons = rows.flat();
    expect(buttons.length).toBe(100);
    expect(rows.at(-1)).toEqual([
      { text: 'Voltar', callback_data: 'm:menu' },
      { text: 'Menu', callback_data: 'm:menu' },
    ]);
  });

  it('callback_data acima de 64 bytes nao vai ao teclado', () => {
    const rows = menuRows({ nodeId: 'menu', title: 'Menu', options: [{ id: 'x'.repeat(70), label: 'Longo' }, { id: 'ok', label: 'Ok' }] });
    expect(rows).toEqual([[{ text: 'Ok', callback_data: 'm:ok' }]]);
  });

  it('nodeIdFromCallback aceita so o formato m:<id> dentro do padrao', () => {
    expect(nodeIdFromCallback('m:inicio.saldo')).toBe('inicio.saldo');
    expect(nodeIdFromCallback(`m:${'a'.repeat(40)}`)).toBe('a'.repeat(40));
    expect(nodeIdFromCallback('m:')).toBeNull();
    expect(nodeIdFromCallback(`m:${'a'.repeat(41)}`)).toBeNull();
    expect(nodeIdFromCallback('m:Financas')).toBeNull();
    expect(nodeIdFromCallback('m:a b')).toBeNull();
    expect(nodeIdFromCallback('x:financas')).toBeNull();
    expect(nodeIdFromCallback('xm:financas')).toBeNull();
    expect(nodeIdFromCallback(' m:financas')).toBeNull();
    expect(nodeIdFromCallback('confirmar')).toBeNull();
  });

  it('MENU vira texto escapado e o teclado inline da view', () => {
    const reply = formatReplyForTelegram({ kind: 'MENU', state: 'IDLE', text: 'Menu <b>', menu: root } as never);
    expect(reply.parts).toEqual(['Menu &lt;b&gt;']);
    expect(reply.markup).toEqual({ kind: 'inline', rows: menuRows(root) });
  });

  it('MENU sem view cai no botao fixo Menu, sem teclado inline vazio', () => {
    const reply = formatReplyForTelegram({ kind: 'MENU', state: 'IDLE', text: 'Menu' } as never);
    expect(reply.markup).toEqual({ kind: 'menu' });
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
