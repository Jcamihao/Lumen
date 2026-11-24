import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreditLimitChangedError } from '../credit-cycle/conversation-write.types';
import { ConversationService } from './conversation.service';
import { ConversationInput } from './conversation.types';
import { formatBrl as brl } from './replies';

type Deps = ConstructorParameters<typeof ConversationService>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const T0 = new Date('2026-11-15T12:00:00.000Z');
const clone = <T,>(value: T): T => (value === null || value === undefined ? value : structuredClone(value));

const CYCLE = {
  ceiling: 2000, spent: 500, remaining: 1500, percentUsed: 25, status: 'ok', closingDay: 5, dueDay: 12,
  countAllPayments: false,
  cycleStart: '2026-11-06T00:00:00.000Z',
  cycleEnd: '2026-12-05T00:00:00.000Z',
};

const CARDS: Row[] = [
  { id: 'cr-nubank', userId: 'A', name: 'Nubank', isDefault: true, archivedAt: null, closingDay: 5, dueDay: 12 },
  { id: 'cr-itau', userId: 'A', name: 'Itaú', isDefault: false, archivedAt: null, closingDay: 5, dueDay: 12 },
  { id: 'cr-vivo', userId: 'A', name: 'Vivo', isDefault: false, archivedAt: null, closingDay: 5, dueDay: 12 },
  { id: 'cr-vivo-pad', userId: 'A', name: 'Vivo Pad', isDefault: false, archivedAt: null, closingDay: 5, dueDay: 12 },
  { id: 'cr-old', userId: 'A', name: 'Antigo', isDefault: false, archivedAt: new Date('2026-10-01T00:00:00.000Z'), closingDay: 3, dueDay: null },
  { id: 'cr-nubank-b', userId: 'B', name: 'Nubank', isDefault: true, archivedAt: null, closingDay: 5, dueDay: 12 },
];

function buildService(cycle: Row = CYCLE) {
  const sessions: Row[] = [];
  const events: Row[] = [];

  const prisma = {
    user: { findUniqueOrThrow: jest.fn(async () => ({ timezone: 'America/Sao_Paulo' })) },
    creditCard: {
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        clone(CARDS.filter((row) => row.userId === where.userId && row.archivedAt === (where.archivedAt ?? null))),
      ),
      findFirst: jest.fn(async ({ where }: { where: Row }) =>
        clone(CARDS.find((row) => row.userId === where.userId && row.isDefault === where.isDefault && row.archivedAt === null) ?? null),
      ),
    },
    conversationSession: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(sessions.find((row) => matches(row, where)) ?? null)),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), version: 1, ...data };
        sessions.push(row);
        return clone(row);
      }),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = sessions.length;
        for (let index = sessions.length - 1; index >= 0; index -= 1) {
          if (matches(sessions[index], where)) sessions.splice(index, 1);
        }
        return { count: before - sessions.length };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const targets = sessions.filter((row) => matches(row, where));
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      }),
    },
    conversationEvent: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), messageId: null, appliedKey: null, resultRef: null, ...data };
        events.push(row);
        return clone(row);
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };

  const setCeiling = jest.fn(async (_userId: string, dto: { ceiling: number }, expected: Row, cardId?: string) => ({
    id: 'ceil-1',
    ceilingCents: Math.round(dto.ceiling * 100),
    cycleStart: expected.cycleStart,
    cycleEnd: expected.cycleEnd,
    cardId: cardId ?? null,
    refreshPending: false,
  }));
  const removeCeiling = jest.fn(async (userId: string, _expected: Row, cardId: string) => {
    const card = CARDS.find((row) => row.id === cardId && row.userId === userId);
    if (!card) throw new NotFoundException('Cartao nao encontrado.');
    return { id: 'ceil-old', removedCents: Math.round(CYCLE.ceiling * 100), cycleStart: '2026-11-06', cycleEnd: '2026-12-05', refreshPending: false };
  });

  const creditCycle = {
    getCurrent: jest.fn(async () => clone(cycle)),
    getCycleForCard: jest.fn(async () => clone(cycle)),
    setCeilingForConversation: setCeiling,
    removeCeilingForConversation: removeCeiling,
  };

  const config = { get: jest.fn(() => 'off') };
  // Ordem do construtor: prisma, dashboard, creditCycle, transactions, recurring, installments, goals, envelopes, entitlements, config, assistant.
  const deps = [prisma, {}, creditCycle, {}, {}, {}, {}, {}, {}, config, {}];
  const service = new ConversationService(...(deps as unknown as Deps));
  let counter = 0;
  const send = (text: string, userId = 'A', channel: 'APP' | 'WHATSAPP' = 'APP') => {
    counter += 1;
    const input: ConversationInput = { userId, channel, messageId: `m${counter}`, text, receivedAt: T0 };
    return service.handleMessage(input);
  };
  return { service, send, sessions, events, setCeiling, removeCeiling, creditCycle, prisma };
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => row[key] === expected);
}

const CLEAR_DONE = `Teto do cartão Nubank removido do ciclo com fechamento em 05/12/2026. Antes: ${brl(200000)}.`;

describe('limite do cartao por nome e limpar teto (8d)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('definir limite por nome: escolhe o cartao, previa mostra o cartao, gravar passa o cartao', async () => {
    const { send, setCeiling, creditCycle, sessions } = buildService();
    const reply = await send('definir limite do nubank 2000');
    expect(reply.kind).toBe('CONFIRM_DRAFT');
    expect(reply.text).toContain('no cartão Nubank');
    expect(reply.draft?.rows.some((row) => row.label === 'Cartão' && row.value === 'Nubank')).toBe(true);
    expect((sessions[0].draft as Row).cardId).toBe('cr-nubank');
    expect(creditCycle.getCycleForCard).toHaveBeenCalledWith('A', 'cr-nubank');

    const done = await send('confirmar');
    expect(done.kind).toBe('DONE');
    expect(done.text).toBe(`Limite de ${brl(200000)} definido no cartão Nubank para o ciclo com fechamento em 05/12/2026.`);
    expect(setCeiling).toHaveBeenCalledWith(
      'A',
      { ceiling: 2000 },
      { cycleStart: '2026-11-06', cycleEnd: '2026-12-05', previousCeilingCents: 200000, countAllPayments: false },
      'cr-nubank',
    );
  });

  it('sem nome segue no padrao, sem linha de cartao (comportamento antigo)', async () => {
    const { send, setCeiling, creditCycle, sessions } = buildService();
    const reply = await send('definir limite 3000');
    expect(reply.draft?.rows.some((row) => row.label === 'Cartão')).toBe(false);
    expect(creditCycle.getCurrent).toHaveBeenCalled();
    expect((sessions[0].draft as Row).cardId).toBeNull();
    await send('confirmar');
    expect(setCeiling).toHaveBeenCalledWith(expect.any(String), { ceiling: 3000 }, expect.anything(), undefined);
  });

  it('nome desconhecido devolve a lista e nao abre sessao; ambiguo tambem', async () => {
    const { send, sessions } = buildService();
    const desconhecido = await send('definir limite do picapau 100');
    expect(desconhecido.text).toContain('Não achei cartão com "picapau"');
    expect(desconhecido.text).toContain('Nubank, Itaú, Vivo, Vivo Pad');
    const ambiguo = await send('mudar limite vi 100');
    expect(ambiguo.text).toContain('Mais de um cartão bate com "vi"');
    expect(ambiguo.text).toContain('Vivo, Vivo Pad');
    expect(sessions).toHaveLength(0);
  });

  it('so o nome: cartao escolhido e valor pedido; o valor seguinte completa', async () => {
    const { send, sessions } = buildService();
    const ask = await send('mudar limite itau');
    expect(ask.kind).toBe('ASK_FIELD');
    expect((sessions[0].draft as Row).cardId).toBe('cr-itau');
    const preview = await send('1500');
    expect(preview.kind).toBe('CONFIRM_DRAFT');
    expect(preview.draft?.rows.some((row) => row.label === 'Cartão' && row.value === 'Itaú')).toBe(true);
  });

  it('limpar: previa pede limpar, confirmar nao limpa, limpar remove pelo servico com snapshot', async () => {
    const { send, removeCeiling, sessions } = buildService();
    const preview = await send('limpar limite do nubank');
    expect(preview.kind).toBe('CONFIRM_DRAFT');
    expect(preview.draft?.title).toBe('Limpar limite do cartão');
    expect(preview.draft?.changeAction).toBe('CLEAR');
    expect(preview.text).toContain('Remover o teto do cartão Nubank');
    expect(preview.draft?.rows.some((row) => row.label === 'Teto atual' && row.value === brl(200000))).toBe(true);
    expect(preview.draft?.rows.some((row) => row.label === 'Aviso')).toBe(true);
    expect(preview.quickReplies).toEqual(['limpar', 'cancelar']);

    const recusado = await send('confirmar');
    expect(recusado.text).toContain('Para limpar o teto, responda limpar.');
    expect(removeCeiling).not.toHaveBeenCalled();

    const done = await send('limpar');
    expect(done.kind).toBe('DONE');
    expect(done.text).toBe(CLEAR_DONE);
    expect(removeCeiling).toHaveBeenCalledWith(
      'A',
      { cycleStart: '2026-11-06', cycleEnd: '2026-12-05', previousCeilingCents: 200000, countAllPayments: false },
      'cr-nubank',
    );
    expect(sessions).toHaveLength(0);
  });

  it('limpar sem nome resolve o cartao padrao e grava o cartao no rascunho', async () => {
    const { send, sessions, removeCeiling } = buildService();
    const preview = await send('limpar limite');
    expect(preview.draft?.rows.some((row) => row.label === 'Cartão' && row.value === 'Nubank')).toBe(true);
    expect((sessions[0].draft as Row).cardId).toBe('cr-nubank');
    await send('limpar');
    expect(removeCeiling).toHaveBeenCalledTimes(1);
  });

  it('ciclo sem teto: recusa curta, sem sessao', async () => {
    const { send, sessions } = buildService({ ...CYCLE, ceiling: null });
    const reply = await send('limpar limite do nubank');
    expect(reply.kind).toBe('INFO');
    expect(reply.text).toBe('Esse cartão já está sem teto neste ciclo.');
    expect(sessions).toHaveLength(0);
  });

  it('REST com flag: sem clear nao remove; com clear remove', async () => {
    const { send, service, sessions, removeCeiling } = buildService();
    await send('limpar limite do nubank');
    const session = sessions[0];
    const recusado = await service.confirmDraft('A', session.id, session.version, false, false);
    expect(recusado?.kind).toBe('ERROR');
    expect(removeCeiling).not.toHaveBeenCalled();
    const done = await service.confirmDraft('A', session.id, session.version, false, true);
    expect(done?.kind).toBe('DONE');
    expect(removeCeiling).toHaveBeenCalledTimes(1);
  });

  it('rascunho adulterado com cartao de B nao limpa teto alheio', async () => {
    const { send, service, sessions, removeCeiling } = buildService();
    await send('limpar limite do nubank');
    const session = sessions[0];
    (session.draft as Row).cardId = 'cr-nubank-b';
    const reply = await service.confirmDraft('A', session.id, session.version, false, true);
    expect(reply?.kind).toBe('ERROR');
    // O servico devolve 404 para cartao alheio: nenhuma linha de B e tocada e a sessao se consume.
    expect(removeCeiling).toHaveBeenCalledWith('A', expect.anything(), 'cr-nubank-b');
    expect(sessions.some((row) => row.id === session.id)).toBe(false);
  });

  it('conflito de snapshot na limpeza: previa renova com o teto atual e so entao limpar vale', async () => {
    const { send, service, sessions, removeCeiling } = buildService();
    await send('limpar limite do nubank');
    const session = sessions[0];
    removeCeiling.mockRejectedValueOnce(new CreditLimitChangedError({ cycleStart: '2026-11-06', cycleEnd: '2026-12-05', previousCeilingCents: 90000, countAllPayments: false }));
    const renewal = await service.confirmDraft('A', session.id, session.version, false, true);
    expect(renewal?.kind).toBe('CONFIRM_DRAFT');
    expect(renewal?.text).toContain('mudou');
    expect(renewal?.draft?.rows.some((row) => row.label === 'Teto atual' && row.value === brl(90000))).toBe(true);
    expect(sessions.some((row) => row.id === session.id)).toBe(true);

    const refreshed = sessions.find((row) => row.id === session.id)!;
    const done = await service.confirmDraft('A', refreshed.id, refreshed.version, false, true);
    expect(done?.kind).toBe('DONE');
    expect(removeCeiling).toHaveBeenLastCalledWith(
      'A',
      { cycleStart: '2026-11-06', cycleEnd: '2026-12-05', previousCeilingCents: 90000, countAllPayments: false },
      'cr-nubank',
    );
  });

  it('rascunho antigo sem action e sem cardId continua no padrao (JSON pre-8d)', async () => {
    const { send, service, sessions, setCeiling } = buildService();
    await send('definir limite 5000');
    const session = sessions[0];
    delete (session.draft as Row).action;
    delete (session.draft as Row).cardId;
    delete (session.draft as Row).cardName;
    const done = await service.confirmDraft('A', session.id, session.version);
    expect(done?.kind).toBe('DONE');
    expect(setCeiling).toHaveBeenCalledWith(expect.any(String), { ceiling: 5000 }, expect.anything(), undefined);
  });

  it('RESTORED do limpar traz titulo, aviso e nenhum atalho de confirmacao', async () => {
    const { send, service } = buildService();
    await send('limpar limite do nubank');
    const restored = await service.getSession('A');
    expect(restored?.state).toBe('AWAITING_CONFIRMATION');
    expect(restored?.draft?.title).toBe('Limpar limite do cartão');
    expect(restored?.draft?.rows.some((row) => row.label === 'Aviso')).toBe(true);
  });

  it('cancelar descarta o limpar sem mexer no teto', async () => {
    const { send, removeCeiling, sessions } = buildService();
    await send('limpar limite do nubank');
    const cancel = await send('cancelar');
    expect(cancel.kind).toBe('CANCELLED');
    expect(removeCeiling).not.toHaveBeenCalled();
    expect(sessions).toHaveLength(0);
  });
});

describe('leitura por cartao e meus cartoes (9b-2)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('nome dito na leitura: texto traz o cartao e a leitura usa o cartao dele (getCycleForCard)', async () => {
    const { send, creditCycle } = buildService();
    const reply = await send('quanto sobrou no Nubank');
    expect(reply.text.startsWith('Cartão: Nubank\n')).toBe(true);
    expect(creditCycle.getCycleForCard).toHaveBeenCalledWith('A', 'cr-nubank');
    expect(creditCycle.getCurrent).not.toHaveBeenCalled();
  });

  it('"cartao" explicito casa sem acento e sem caixa', async () => {
    const { send, creditCycle } = buildService();
    const reply = await send('cartao ITAU');
    expect(reply.text.startsWith('Cartão: Itaú\n')).toBe(true);
    expect(creditCycle.getCycleForCard).toHaveBeenCalledWith('A', 'cr-itau');
  });

  it('nome inexistente com "cartao" responde a lista, sem erro e sem consultar ciclo', async () => {
    const { send, creditCycle } = buildService();
    const reply = await send('cartao picapau');
    expect(reply.text).toContain('Não achei cartão com "picapau"');
    expect(reply.text).toContain('Nubank, Itaú, Vivo, Vivo Pad');
    expect(creditCycle.getCycleForCard).not.toHaveBeenCalled();
  });

  it('nome ambiguo com "cartao" responde a lista de quem bate', async () => {
    const { send, creditCycle } = buildService();
    const reply = await send('fatura do cartao vi');
    expect(reply.text).toContain('Mais de um cartão bate com "vi"');
    expect(reply.text).toContain('Vivo, Vivo Pad');
    expect(creditCycle.getCycleForCard).not.toHaveBeenCalled();
  });

  it('forma sem a palavra cartao so le com nome EXATO; nome que nao casa segue o caminho de hoje', async () => {
    const { send, creditCycle } = buildService();
    const naoEhCartao = await send('quanto sobrou no picapau');
    expect(naoEhCartao.text).not.toContain('Não achei');
    expect(naoEhCartao.text).not.toContain('Cartão:');
    expect(creditCycle.getCycleForCard).not.toHaveBeenCalled();
    const exato = await send('quanto sobrou no Vivo');
    expect(exato.text.startsWith('Cartão: Vivo\n')).toBe(true);
    expect(creditCycle.getCycleForCard).toHaveBeenCalledWith('A', 'cr-vivo');
    const exatoDois = await send('fatura do vivo pad');
    expect(exatoDois.text.startsWith('Cartão: Vivo Pad\n')).toBe(true);
    // Nome que so casa de forma parcial ("nubank estourou") nao e cartao na forma sem a palavra cartao.
    const parcial = await send('quanto sobrou no nubank estourou');
    expect(parcial.text).not.toContain('Cartão:');
    expect(creditCycle.getCycleForCard).toHaveBeenCalledTimes(2);
  });

  it('forma sem a palavra cartao com nome que casa mais de um (exato nao) segue o caminho de hoje', async () => {
    const { send, creditCycle } = buildService();
    const reply = await send('limite do vi');
    expect(reply.text).not.toContain('Cartão:');
    expect(creditCycle.getCycleForCard).not.toHaveBeenCalled();
  });

  it('sem nome segue o cartao padrao, sem linha de cartao (como antes)', async () => {
    const { send, creditCycle } = buildService();
    const reply = await send('quanto sobrou no cartao');
    expect(reply.text.startsWith('Cartão:')).toBe(false);
    expect(creditCycle.getCurrent).toHaveBeenCalled();
    expect(creditCycle.getCycleForCard).not.toHaveBeenCalled();
  });

  it('cartao arquivado nao casa: responde a lista', async () => {
    const { send, creditCycle } = buildService();
    const reply = await send('cartao Antigo');
    expect(reply.text).toContain('Não achei cartão com "Antigo"');
    expect(reply.text).not.toContain('Antigo,');
    expect(creditCycle.getCycleForCard).not.toHaveBeenCalled();
  });

  it('isolamento: cartao de B nao casa para A; A ve so os proprios', async () => {
    const { send: sendA, creditCycle } = buildService();
    const { send: sendB } = buildService();
    const naoDeA = await sendA('cartao Nubank', 'A');
    expect(naoDeA.text.startsWith('Cartão: Nubank\n')).toBe(true);
    expect(creditCycle.getCycleForCard).toHaveBeenLastCalledWith('A', 'cr-nubank');
    const listaB = await sendB('meus cartoes', 'B');
    expect(listaB.text).toBe('Seus cartões:\n- Nubank (padrão): fechamento dia 5, vencimento dia 12');
  });

  it('"meus cartoes": lista ativos, padrao marcado, sem consultar ciclo', async () => {
    const { send, creditCycle } = buildService();
    const reply = await send('meus cartoes');
    expect(reply.kind).toBe('INFO');
    expect(reply.text).toBe(
      [
        'Seus cartões:',
        '- Nubank (padrão): fechamento dia 5, vencimento dia 12',
        '- Itaú: fechamento dia 5, vencimento dia 12',
        '- Vivo: fechamento dia 5, vencimento dia 12',
        '- Vivo Pad: fechamento dia 5, vencimento dia 12',
      ].join('\n'),
    );
    expect(reply.text).not.toContain('Antigo');
    expect(creditCycle.getCycleForCard).not.toHaveBeenCalled();
  });

  it('"meus cartoes" consulta so cartoes do dono e ativos, com ordem do 8d', async () => {
    const { send, prisma } = buildService();
    await send('quais cartoes', 'A');
    expect(prisma.creditCard.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 'A', archivedAt: null },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
    );
  });

  it('usuario sem cartao ativo: resposta curta, sem erro', async () => {
    const { send } = buildService();
    const reply = await send('meus cartoes', 'C');
    expect(reply.text).toBe('Você ainda não tem cartão ativo.');
  });
});
