import { randomUUID } from 'crypto';
import { ConversationService } from './conversation.service';
import { ConversationInput } from './conversation.types';
import { formatBrl as brl } from './replies';

type Deps = ConstructorParameters<typeof ConversationService>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const T0 = new Date('2026-11-15T12:00:00.000Z');
const clone = <T,>(value: T): T => (value === null || value === undefined ? value : structuredClone(value));

/** Filtro do banco fake: igualdade, lista (in) e not-null. */
function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('in' in expected) return (expected.in as unknown[]).includes(row[key]);
      if ('not' in expected) return row[key] !== expected.not;
    }
    return row[key] === expected;
  });
}

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

function recurringRow(overrides: Row): Row {
  return {
    description: 'Conta',
    amount: '55.90',
    frequency: 'MONTHLY',
    nextDueDate: day('2026-12-05'),
    endDate: null,
    isActive: true,
    card: null,
    updatedAt: new Date('2026-11-10T10:00:00.000Z'),
    ...overrides,
  };
}

function installmentRow(overrides: Row): Row {
  return {
    description: 'Parcelado',
    installmentAmount: '300.00',
    totalAmount: '3600.00',
    installmentsTotal: 12,
    installmentsGenerated: 4,
    nextDueDate: day('2026-12-10'),
    isActive: true,
    card: null,
    updatedAt: new Date('2026-11-10T10:00:00.000Z'),
    ...overrides,
  };
}

const RECURRINGS: Row[] = [
  recurringRow({ id: 'r1', userId: 'A', description: 'Netflix', amount: '55.90', nextDueDate: day('2026-12-05'), updatedAt: day('2026-11-12') }),
  recurringRow({ id: 'r2', userId: 'A', description: 'Netflix das férias', isActive: false, nextDueDate: day('2027-01-10'), updatedAt: day('2026-11-11') }),
  recurringRow({ id: 'r3', userId: 'B', description: 'Netflix de B', updatedAt: day('2026-11-11') }),
];

const INSTALLMENTS: Row[] = [
  installmentRow({ id: 'i1', userId: 'A', description: 'TV de 50', updatedAt: day('2026-11-12') }),
  installmentRow({ id: 'i2', userId: 'A', description: 'Notebook', isActive: false, updatedAt: day('2026-11-11') }),
  installmentRow({ id: 'i3', userId: 'A', description: 'iPhone', nextDueDate: null, installmentsGenerated: 12, updatedAt: day('2026-11-10') }),
  installmentRow({ id: 'i4', userId: 'B', description: 'TV de B', updatedAt: day('2026-11-11') }),
];

function buildService(rows: { recurrencings?: Row[]; installments?: Row[] } = {}) {
  const recurrencings = (rows.recurrencings ?? RECURRINGS).map((row) => clone(row));
  const installmentRows = (rows.installments ?? INSTALLMENTS).map((row) => clone(row));
  const sessions: Row[] = [];
  const events: Row[] = [];

  const tableFor = (model: string): Row[] => (model === 'recurring' ? recurrencings : installmentRows);
  const fakeTable = (model: string) => ({
    findMany: jest.fn(async ({ where }: { where: Row }) =>
      clone(
        tableFor(model)
          .filter((row) => matchesWhere(row, where))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
      ),
    ),
    findFirst: jest.fn(async ({ where }: { where: Row }) => clone(tableFor(model).find((row) => matchesWhere(row, where)) ?? null)),
  });

  const prisma = {
    user: { findUniqueOrThrow: jest.fn(async () => ({ timezone: 'America/Sao_Paulo' })) },
    conversationSession: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(sessions.find((row) => matchesWhere(row, where)) ?? null)),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), version: 1, ...data };
        sessions.push(row);
        return clone(row);
      }),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = sessions.length;
        for (let index = sessions.length - 1; index >= 0; index -= 1) {
          if (matchesWhere(sessions[index], where)) sessions.splice(index, 1);
        }
        return { count: before - sessions.length };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const targets = sessions.filter((row) => matchesWhere(row, where));
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
    transaction: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    financeCategory: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    goal: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    envelope: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    recurringTransaction: fakeTable('recurring'),
    installmentPurchase: fakeTable('installment'),
  };

  /** Mesmos servicos da tela: apagar some com a linha; update grava os campos do DTO. */
  const recurringService = {
    createForConversation: jest.fn(),
    remove: jest.fn(async (userId: string, id: string) => {
      const index = recurrencings.findIndex((row) => row.id === id && row.userId === userId);
      if (index === -1) throw new Error('Conta fixa nao encontrada.');
      recurrencings.splice(index, 1);
      return { success: true };
    }),
    update: jest.fn(async (userId: string, id: string, dto: Row) => {
      const row = recurrencings.find((candidate) => candidate.id === id && candidate.userId === userId);
      if (!row) throw new Error('Conta fixa nao encontrada.');
      if (dto.description !== undefined) row.description = dto.description;
      if (dto.amount !== undefined) row.amount = dto.amount.toFixed(2);
      if (dto.endDate !== undefined) row.endDate = dto.endDate === null ? null : day(dto.endDate);
      return clone(row);
    }),
  };
  const installmentsService = {
    createForConversation: jest.fn(),
    remove: jest.fn(async (userId: string, id: string) => {
      const index = installmentRows.findIndex((row) => row.id === id && row.userId === userId);
      if (index === -1) throw new Error('Compra parcelada nao encontrada.');
      installmentRows.splice(index, 1);
      return { success: true };
    }),
  };

  const config = { get: jest.fn((key: string) => (key === 'whatsapp.writesEnabled' ? true : 'off')) };
  // Ordem do construtor: prisma, dashboard, creditCycle, transactions, recurring, installments, goals, envelopes, entitlements, config, assistant.
  const deps = [prisma, {}, {}, {}, recurringService, installmentsService, {}, {}, {}, config, {}];
  const service = new ConversationService(...(deps as unknown as Deps));
  let counter = 0;
  const send = (text: string, userId = 'A', channel: 'APP' | 'WHATSAPP' = 'APP') => {
    counter += 1;
    const input: ConversationInput = { userId, channel, messageId: `m${counter}`, text, receivedAt: T0 };
    return service.handleMessage(input);
  };
  return { service, send, recurrencings, installmentRows, recurringService, installmentsService, sessions };
}

const RECURRING_CHANGED = 'Essa conta fixa mudou desde que você escolheu; refaça a busca.';
const INSTALLMENT_NO_EDIT = 'Compra parcelada não tem edição nem na tela. Se precisar, apague e crie de novo.';

describe('editar/apagar contas fixas e parcelados por conversa (8c, secoes 3 a 5)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lista numerada de contas fixas: so do dono, pausada inclusa', async () => {
    const { send, sessions } = buildService();
    const reply = await send('apagar conta fixa netflix');
    expect(reply.kind).toBe('ASK_FIELD');
    expect(reply.text).toContain('Qual conta fixa? Responda com o número:');
    expect(reply.text).toContain('1) Netflix · 55,90/mês · vence 05/12/2026 · ativa');
    expect(reply.text).toContain('2) Netflix das férias · 55,90/mês · vence 10/01/2027 · pausada');
    expect(reply.text).not.toContain('Netflix de B');
    expect((sessions[0].draft as Row).candidateIds).toEqual(['r1', 'r2']);
  });

  it('parcelado: lista so o que ainda tem parcela a gerar (pausado e concluido ficam fora)', async () => {
    const { send } = buildService();
    const found = await send('apagar parcelado tv');
    expect(found.text).toContain('1) TV de 50 · 300,00 · 4 de 12 · vence 10/12/2026');
    expect(found.text).not.toContain('TV de B');
    await send('cancelar');
    const paused = await send('apagar parcelado notebook');
    expect(paused.text).toBe('Não achei compra parcelada com isso.');
    const done = await send('apagar parcelado iphone');
    expect(done.text).toBe('Não achei compra parcelada com isso.');
  });

  it('comando sem termo pergunta qual conta; o texto seguinte busca', async () => {
    const { send } = buildService();
    const ask = await send('excluir fixa');
    expect(ask.text).toBe('Qual conta fixa? Diga parte do nome. Ex.: apagar conta fixa netflix');
    const list = await send('netflix');
    expect(list.text).toContain('Qual conta fixa? Responda com o número:');
  });

  it('editar parcelado: recusa curta, sem sessao (D3 do dono)', async () => {
    const { send, sessions } = buildService();
    const reply = await send('editar parcelado tv');
    expect(reply.kind).toBe('INFO');
    expect(reply.text).toBe(INSTALLMENT_NO_EDIT);
    expect(sessions).toHaveLength(0);
  });

  it('apagar conta fixa: previa com aviso, recusa sem a palavra, apaga pelo servico da tela', async () => {
    const { send, recurringService, sessions } = buildService();
    await send('apagar conta fixa netflix');
    const chosen = await send('1');
    expect(chosen.kind).toBe('CONFIRM_DRAFT');
    expect(chosen.text).toContain('Apagar conta fixa: Netflix · 55,90/mês.');
    expect(chosen.text).toContain('Os lançamentos já gerados continuam no extrato, soltos. Os próximos não vão mais ser gerados.');
    expect(chosen.text).toContain('Isto apaga de vez e não dá para desfazer.');
    expect(chosen.quickReplies).toEqual(['apagar', 'cancelar']);
    const refused = await send('confirmar');
    expect(refused.text).toContain('Para apagar, responda apagar.');
    expect(recurringService.remove).not.toHaveBeenCalled();
    const done = await send('apagar');
    expect(done.kind).toBe('DONE');
    expect(done.text).toBe('Apaguei a conta fixa "Netflix". Os lançamentos já gerados continuam no extrato, soltos. Os próximos não vão mais ser gerados.');
    expect(done.data?.recurringTransactionId).toBe('r1');
    expect(recurringService.remove).toHaveBeenCalledWith('A', 'r1');
    expect(sessions).toHaveLength(0);
  });

  it('confirmDraft de apagar SEM a flag nao apaga; com a flag apaga', async () => {
    const { send, service, sessions, recurringService } = buildService();
    await send('apagar conta fixa netflix');
    await send('1');
    const session = sessions[0];
    const refused = await service.confirmDraft('A', session.id, session.version, false);
    expect(refused?.kind).toBe('ERROR');
    const done = await service.confirmDraft('A', session.id, session.version, true);
    expect(done?.kind).toBe('DONE');
    expect(recurringService.remove).toHaveBeenCalledTimes(1);
  });

  it('apagar parcelado pelo chat: previa com progresso e apaga uma compra', async () => {
    const { send, installmentsService, installmentRows } = buildService();
    await send('apagar parcelado tv');
    const chosen = await send('1');
    expect(chosen.text).toContain('Apagar compra parcelada: TV de 50 · 300,00 por parcela · 4 de 12.');
    expect(chosen.text).toContain('As parcelas já geradas continuam no extrato, soltas. As que faltavam somem com a compra.');
    const done = await send('apagar');
    expect(done.kind).toBe('DONE');
    expect(done.data?.installmentPurchaseId).toBe('i1');
    expect(installmentsService.remove).toHaveBeenCalledWith('A', 'i1');
    expect(installmentRows.some((row) => row.id === 'i1')).toBe(false);
  });

  it('conflito de updatedAt: apagar conta fixa recusa quando a tela mexeu no meio', async () => {
    const { send, recurrencings, recurringService } = buildService();
    await send('apagar conta fixa netflix');
    await send('1');
    const row = recurrencings.find((candidate) => candidate.id === 'r1')!;
    row.amount = '70.00';
    row.updatedAt = day('2026-11-14');
    const reply = await send('apagar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(RECURRING_CHANGED);
    expect(recurringService.remove).not.toHaveBeenCalled();
    expect(recurrencings.some((candidate) => candidate.id === 'r1')).toBe(true);
  });

  it('editar conta fixa: valor e descricao aplicam pelo servico da tela, com antes -> depois', async () => {
    const { send, recurringService, recurrencings } = buildService();
    await send('corrigir conta fixa netflix');
    await send('1');
    const preview = await send('valor 70');
    expect(preview.kind).toBe('CONFIRM_DRAFT');
    expect(preview.draft?.changeAction).toBe('EDIT');
    expect(preview.draft?.title).toBe('Editar conta fixa');
    expect(preview.draft?.rows).toEqual([{ label: 'Valor', value: `${brl(5590)} → ${brl(7000)}` }]);
    await send('confirmar');
    expect(recurringService.update).toHaveBeenCalledWith('A', 'r1', { amount: 70 });
    expect(recurrencings.find((row) => row.id === 'r1')!.amount).toBe('70.00');

    await send('corrigir conta fixa netflix');
    await send('1');
    const renamed = await send('nome Netflix básico');
    expect(renamed.draft?.rows).toEqual([{ label: 'Nome', value: 'Netflix → Netflix básico' }]);
    await send('confirmar');
    expect(recurringService.update).toHaveBeenLastCalledWith('A', 'r1', { description: 'Netflix básico' });
  });

  it('editar conta fixa: data final aceita mm/aaaa com ano, "sem prazo" limpa', async () => {
    const { send, service, sessions, recurringService, recurrencings } = buildService();
    await send('editar conta fixa netflix');
    await send('1');
    const preview = await send('data final 20/12/2027');
    expect(preview.draft?.rows).toEqual([{ label: 'Data final', value: `sem prazo → 20/12/2027` }]);
    const session = sessions[sessions.length - 1];
    await service.confirmDraft('A', session.id, session.version);
    expect(recurringService.update).toHaveBeenLastCalledWith('A', 'r1', { endDate: '2027-12-20' });
    expect(recurrencings.find((row) => row.id === 'r1')!.endDate).toEqual(day('2027-12-20'));

    await send('editar conta fixa netflix');
    await send('1');
    const limpa = await send('sem prazo');
    expect(limpa.draft?.rows).toEqual([{ label: 'Data final', value: '20/12/2027 → sem prazo' }]);
  });

  it('mudanca igual ao valor atual: previa diz nada para mudar; termo sem chave recebe a ajuda', async () => {
    const { send, recurringService } = buildService();
    await send('editar conta fixa netflix');
    await send('1');
    const nada = await send('valor 55,90');
    expect(nada.text).toContain('Nada para mudar.');
    expect(recurringService.update).not.toHaveBeenCalled();
    await send('editar conta fixa netflix');
    await send('1');
    const ruim = await send('frequência semanal');
    expect(ruim.text).toBe('Não entendi a mudança. Use: nome netflix, valor 100 ou prazo 20/12.');
  });

  it('rascunho adulterado com id da conta de B nao apaga a conta de B', async () => {
    const { send, sessions, recurrencings, recurringService } = buildService();
    await send('apagar conta fixa netflix');
    await send('1');
    const draft = sessions[0].draft as Row;
    const deB = recurrencings.find((row) => row.id === 'r3')!;
    draft.targetId = 'r3';
    draft.targetUpdatedAt = deB.updatedAt.toISOString();
    const reply = await send('apagar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe('Não encontrei mais essa conta fixa.');
    expect(recurringService.remove).not.toHaveBeenCalled();
    expect(recurrencings.some((row) => row.id === 'r3')).toBe(true);
  });

  it('cartao restaurado traz o apagar de conta fixa com aviso e sem o atalho apagar', async () => {
    const { send, service } = buildService();
    await send('apagar conta fixa netflix');
    await send('1');
    const restored = await service.getSession('A');
    expect(restored?.state).toBe('AWAITING_CONFIRMATION');
    expect(restored?.draft?.kind).toBe('RECURRING_CHANGE');
    expect(restored?.draft?.title).toBe('Apagar conta fixa');
    expect(restored?.draft?.changeAction).toBe('DELETE');
    expect(restored?.draft?.rows.some((row) => row.label === 'Aviso')).toBe(true);
  });

  it('"conta" sozinho continua sendo lancamento (D1 do dono)', async () => {
    const { send } = buildService();
    const reply = await send('apagar conta');
    expect(reply.text).toBe('Você ainda não tem lançamentos que dê para mudar por aqui. Para registrar um, diga: gastei 50 no mercado.');
  });
});
