import { randomUUID } from 'crypto';
import { ConversationService } from './conversation.service';
import { ConversationInput } from './conversation.types';
import { formatBrl as brl } from './replies';

type Deps = ConstructorParameters<typeof ConversationService>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const T0 = new Date('2026-11-15T12:00:00.000Z');
const clone = <T,>(value: T): T => (value === null || value === undefined ? value : structuredClone(value));

/** Filtro do banco fake: igualdade e lista (in). */
function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('in' in expected) return (expected.in as unknown[]).includes(row[key]);
    }
    return row[key] === expected;
  });
}

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

function goalRow(overrides: Row): Row {
  return {
    title: 'Sem nome',
    status: 'ACTIVE',
    targetAmount: '500.00',
    currentAmount: '100.00',
    targetDate: null,
    updatedAt: new Date('2026-11-10T10:00:00.000Z'),
    ...overrides,
  };
}

function envelopeRow(overrides: Row): Row {
  return {
    name: 'Reserva',
    monthlyAmount: '200.00',
    isActive: true,
    updatedAt: new Date('2026-11-10T10:00:00.000Z'),
    ...overrides,
  };
}

const GOALS: Row[] = [
  goalRow({ id: 'g1', userId: 'A', title: 'Viagem ao Japão', targetAmount: '5000.00', currentAmount: '1200.00', targetDate: day('2026-12-20'), updatedAt: day('2026-11-12') }),
  goalRow({ id: 'g2', userId: 'A', title: 'Viagem de carro', status: 'PAUSED', targetAmount: null, currentAmount: '300.00', updatedAt: day('2026-11-11') }),
  goalRow({ id: 'g3', userId: 'B', title: 'Viagem de B', updatedAt: day('2026-11-11') }),
  goalRow({ id: 'g4', userId: 'A', title: 'Casa nova', updatedAt: day('2026-11-09') }),
];

const ENVELOPES: Row[] = [
  envelopeRow({ id: 'e1', userId: 'A', name: 'Gasolina', monthlyAmount: '200.00', updatedAt: day('2026-11-12') }),
  envelopeRow({ id: 'e2', userId: 'A', name: 'Lazer', isActive: false, monthlyAmount: '80.00', updatedAt: day('2026-11-11') }),
  envelopeRow({ id: 'e3', userId: 'B', name: 'Gasolina de B', updatedAt: day('2026-11-11') }),
];

function buildService(rows: { goals?: Row[]; envelopes?: Row[] } = {}, writesEnabled = true) {
  const goals = (rows.goals ?? GOALS).map((row) => clone(row));
  const envelopes = (rows.envelopes ?? ENVELOPES).map((row) => clone(row));
  const sessions: Row[] = [];
  const events: Row[] = [];

  const tableFor = (model: string): Row[] => (model === 'goal' ? goals : envelopes);
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
    goal: fakeTable('goal'),
    envelope: fakeTable('envelope'),
  };

  /** Mesmos servicos da tela: remover e atualizar mexem nas linhas do fake. */
  const goalsService = {
    create: jest.fn(),
    contribute: jest.fn(),
    list: jest.fn(async () => []),
    remove: jest.fn(async (userId: string, id: string) => {
      const index = goals.findIndex((row) => row.id === id && row.userId === userId);
      if (index === -1) throw new Error('Meta nao encontrada.');
      goals.splice(index, 1);
      return { success: true };
    }),
    update: jest.fn(async (userId: string, id: string, dto: Row) => {
      const row = goals.find((candidate) => candidate.id === id && candidate.userId === userId);
      if (!row) throw new Error('Meta nao encontrada.');
      if (dto.title !== undefined) row.title = dto.title;
      if (dto.targetAmount !== undefined) row.targetAmount = dto.targetAmount === null ? null : String(dto.targetAmount.toFixed(2));
      if (dto.targetDate !== undefined) row.targetDate = dto.targetDate === null ? null : new Date(dto.targetDate);
      return clone(row);
    }),
  };
  const envelopesService = {
    createForConversation: jest.fn(),
    remove: jest.fn(async (userId: string, id: string) => {
      const index = envelopes.findIndex((row) => row.id === id && row.userId === userId);
      if (index === -1) throw new Error('Envelope nao encontrado.');
      envelopes.splice(index, 1);
      return { success: true };
    }),
    update: jest.fn(async (userId: string, id: string, dto: Row) => {
      const row = envelopes.find((candidate) => candidate.id === id && candidate.userId === userId);
      if (!row) throw new Error('Envelope nao encontrado.');
      if (dto.name !== undefined) row.name = dto.name;
      if (dto.monthlyAmount !== undefined) row.monthlyAmount = String(dto.monthlyAmount.toFixed(2));
      return clone(row);
    }),
  };

  const config = { get: jest.fn((key: string) => (key === 'whatsapp.writesEnabled' ? writesEnabled : 'off')) };
  const deps = [prisma, {}, {}, {}, {}, {}, goalsService, envelopesService, {}, config, {}];
  const service = new ConversationService(...(deps as unknown as Deps));
  let counter = 0;
  const send = (text: string, userId = 'A', channel: 'APP' | 'WHATSAPP' = 'APP') => {
    counter += 1;
    const input: ConversationInput = { userId, channel, messageId: `m${counter}`, text, receivedAt: T0 };
    return service.handleMessage(input);
  };
  return { service, send, goals, envelopes, goalsService, envelopesService, sessions };
}

const GOAL_CHANGED = 'Essa meta mudou desde que você escolheu; refaça a busca.';

describe('editar/apagar metas por conversa (8b, secoes 3 a 5)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lista numerada so das metas do proprio usuario, com status e prazo', async () => {
    const { send, sessions } = buildService();
    const reply = await send('apagar meta viagem');
    expect(reply.kind).toBe('ASK_FIELD');
    expect(reply.text).toContain('Qual meta? Responda com o número:');
    expect(reply.text).toContain('1) Viagem ao Japão · ativa · 1200,00 de 5000,00 · prazo 20/12/2026');
    expect(reply.text).toContain('2) Viagem de carro · pausada · guardado 300,00 (sem alvo)');
    expect(reply.text).not.toContain('Viagem de B');
    expect((sessions[0].draft as Row).candidateIds).toEqual(['g1', 'g2']);
  });

  it('comando sem termo pergunta qual meta', async () => {
    const { send } = buildService();
    const reply = await send('apagar meta');
    expect(reply.text).toBe('Qual meta? Diga parte do nome. Ex.: apagar meta viagem');
  });

  it('busca sem resultado: INFO e sem sessao', async () => {
    const { send, sessions } = buildService();
    const reply = await send('apagar meta nada a ver');
    expect(reply.kind).toBe('INFO');
    expect(reply.text).toBe('Não achei meta com isso.');
    expect(sessions).toHaveLength(0);
  });

  it('termo que e de outro usuario nao e achado (busca so com userId)', async () => {
    const { send, sessions } = buildService();
    const reply = await send('apagar meta viagem de b');
    expect(reply.text).toBe('Não achei meta com isso.');
    expect(sessions).toHaveLength(0);
  });

  it('apagar: numero escolhe, previa mostra o alvo e exige a palavra apagar', async () => {
    const { send, goalsService, sessions } = buildService();
    await send('apagar meta casa');
    const chosen = await send('1');
    expect(chosen.kind).toBe('CONFIRM_DRAFT');
    expect(chosen.text).toContain('Apagar meta: Casa nova · 100,00 guardados · alvo 500,00.');
    expect(chosen.text).toContain('Os aportes já feitos continuam no extrato, soltos.');
    expect(chosen.text).toContain('Isto apaga de vez e não dá para desfazer.');
    expect(chosen.quickReplies).toEqual(['apagar', 'cancelar']);
    const refused = await send('confirmar');
    expect(refused.text).toContain('Para apagar, responda apagar.');
    expect(goalsService.remove).not.toHaveBeenCalled();
    const done = await send('apagar');
    expect(done.kind).toBe('DONE');
    expect(done.text).toBe('Apaguei a meta "Casa nova". Os aportes já feitos continuam no extrato, soltos.');
    expect(done.data?.goalId).toBeDefined();
    expect(goalsService.remove).toHaveBeenCalledTimes(1);
    expect(goalsService.remove).toHaveBeenCalledWith('A', 'g4');
    expect(sessions).toHaveLength(0);
  });

  it('confirmDraft de apagar SEM a flag nao apaga; com a flag apaga uma vez', async () => {
    const { send, service, sessions, goalsService } = buildService();
    await send('apagar meta casa');
    await send('1');
    const session = sessions[0];
    const refused = await service.confirmDraft('A', session.id, session.version, false);
    expect(refused?.kind).toBe('ERROR');
    expect(refused?.text).toBe('Para apagar, responda apagar.');
    const done = await service.confirmDraft('A', session.id, session.version, true);
    expect(done?.kind).toBe('DONE');
    expect(goalsService.remove).toHaveBeenCalledTimes(1);
  });

  it('editar meta: valor, titulo, sem alvo e prazo geram antes -> depois e aplicam pelo servico da tela', async () => {
    const { send, service, sessions, goalsService, goals } = buildService();
    await send('corrigir meta casa');
    await send('1');
    const ask = await send('valor 800');
    expect(ask.kind).toBe('CONFIRM_DRAFT');
    expect(ask.draft?.changeAction).toBe('EDIT');
    expect(ask.draft?.title).toBe('Editar meta');
    expect(ask.draft?.rows).toEqual([{ label: 'Valor alvo', value: `${brl(50000)} → ${brl(80000)}` }]);
    await send('confirmar');
    expect(goalsService.update).toHaveBeenCalledTimes(1);
    expect(goalsService.update).toHaveBeenCalledWith('A', 'g4', { targetAmount: 800 });
    expect(goals.find((row) => row.id === 'g4')!.targetAmount).toBe('800.00');
    expect(sessions.filter((row) => row.intent === 'edit_goal')).toHaveLength(0);

    // "sem alvo" e "sem prazo" viram null; uma mudanca nova por sessao.
    await send('corrigir meta viagem ao japão');
    await send('1');
    await send('sem alvo');
    const session = sessions[sessions.length - 1];
    await service.confirmDraft('A', session.id, session.version);
    expect(goalsService.update).toHaveBeenLastCalledWith('A', 'g1', { targetAmount: null });

    await send('corrigir meta casa');
    await send('1');
    const prazo = await send('prazo 12/2026');
    expect(prazo.draft?.rows).toEqual([{ label: 'Prazo', value: 'sem prazo → 31/12/2026' }]);
    const prazoSession = sessions[sessions.length - 1];
    await service.confirmDraft('A', prazoSession.id, prazoSession.version);
    expect(goalsService.update).toHaveBeenLastCalledWith('A', 'g4', { targetDate: '2026-12-31T00:00:00.000Z' });

    await send('corrigir meta casa');
    await send('1');
    const titulo = await send('título Casa própria');
    expect(titulo.draft?.rows).toEqual([{ label: 'Título', value: 'Casa nova → Casa própria' }]);
  });

  it('editar sem nenhuma mudanca: confirmar nao grava', async () => {
    const { send, goalsService, sessions } = buildService();
    await send('corrigir meta casa');
    await send('1');
    const reply = await send('confirmar');
    expect(reply.text).toContain('Nada para mudar.');
    expect(goalsService.update).not.toHaveBeenCalled();
    expect(sessions).toHaveLength(1);
  });

  it('mudanca que nao casa com nada recebe a ajuda de vocabulario', async () => {
    const { send } = buildService();
    await send('corrigir meta casa');
    await send('1');
    const reply = await send('fundo 200');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe('Não entendi a mudança. Use: título viagem, valor 800, sem alvo ou prazo 20/12.');
  });

  it('lista limita a 5 metas candidatas', async () => {
    const muitas = Array.from({ length: 7 }, (_, index) => goalRow({ id: `k${index}`, userId: 'A', title: `Fundo ${index}`, updatedAt: day(`2026-11-0${index + 1}`) }));
    const { send, sessions } = buildService({ goals: muitas, envelopes: [] });
    await send('apagar meta fundo');
    expect((sessions[0].draft as Row).candidateIds).toHaveLength(5);
  });

  it('mudanca igual ao valor atual: previa diz nada para mudar', async () => {
    const { send } = buildService();
    await send('corrigir meta casa');
    await send('1');
    const preview = await send('valor 500');
    expect(preview.text).toContain('Nada para mudar.');
    expect(preview.draft?.rows).toEqual([{ label: 'Meta', value: 'escolhido' }]);
  });

  it('conflito de updatedAt: apagar e editar recusam quando a meta mudou pela tela', async () => {
    const { send, service, sessions, goals, goalsService } = buildService();
    await send('apagar meta casa');
    await send('1');
    goals.find((row) => row.id === 'g4')!.updatedAt = new Date('2026-11-15T09:00:00.000Z');
    const refused = await send('apagar');
    expect(refused.kind).toBe('ERROR');
    expect(refused.text).toBe(GOAL_CHANGED);
    expect(goalsService.remove).not.toHaveBeenCalled();
    expect(sessions).toHaveLength(0);

    await send('corrigir meta casa');
    await send('1');
    await send('valor 700');
    goals.find((row) => row.id === 'g4')!.updatedAt = new Date('2026-11-15T09:30:00.000Z');
    const editRefused = await send('confirmar');
    expect(editRefused.text).toBe(GOAL_CHANGED);
    expect(goalsService.update).not.toHaveBeenCalled();
  });

  it('meta que sumiu antes de confirmar: recusa sem gravar', async () => {
    const { send, goals, goalsService } = buildService();
    await send('apagar meta casa');
    await send('1');
    goals.splice(goals.findIndex((row) => row.id === 'g4'), 1);
    const reply = await send('apagar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe('Não encontrei mais essa meta.');
    expect(goalsService.remove).not.toHaveBeenCalled();
  });

  it('sessao restaurada traz o cartao de apagar meta com aviso e changeAction', async () => {
    const { send, service, goalsService } = buildService();
    await send('apagar meta casa');
    await send('1');
    const restored = await service.getSession('A');
    expect(restored.state).toBe('AWAITING_CONFIRMATION');
    expect(restored.draft?.kind).toBe('GOAL_CHANGE');
    expect(restored.draft?.changeAction).toBe('DELETE');
    expect(restored.draft?.title).toBe('Apagar meta');
    expect(restored.draft?.rows).toEqual([
      { label: 'Nome', value: 'Casa nova' },
      { label: 'Situação', value: 'ativa' },
      { label: 'Guardado', value: `${brl(10000)}` },
      { label: 'Alvo', value: `${brl(50000)}` },
      { label: 'Aviso', value: 'Os aportes já feitos continuam no extrato, soltos.' },
    ]);
    expect(goalsService.remove).not.toHaveBeenCalled();
  });

  it('cancelar descarta sem gravar', async () => {
    const { send, goalsService, sessions } = buildService();
    await send('corrigir meta casa');
    await send('1');
    await send('valor 900');
    const reply = await send('cancelar');
    expect(reply.kind).toBe('CANCELLED');
    expect(goalsService.update).not.toHaveBeenCalled();
    expect(sessions).toHaveLength(0);
  });
});

describe('editar/apagar reservas por conversa (8b, secoes 3 a 5)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lista reserva pausada tb (qualquer situacao), com valor mensal', async () => {
    const { send } = buildService();
    const reply = await send('apagar reserva');
    expect(reply.text).toBe('Qual reserva? Diga parte do nome. Ex.: apagar reserva gasolina');
    const search = await send('la');
    expect(search.text).toContain('Lazer · 80,00/mês · pausada');
    expect(search.text).not.toContain('Gasolina de B');
  });

  it('apagar reserva: previa com aviso dos depositos e palavra apagar', async () => {
    const { send, envelopesService, envelopes } = buildService();
    await send('editar reserva gasolina');
    await send('1');
    const ask = await send('valor mensal 250');
    expect(ask.draft?.rows).toEqual([
      { label: 'Valor mensal', value: `${brl(20000)} → ${brl(25000)}` },
      { label: 'Aviso', value: 'O valor mensal novo vale a partir do próximo depósito.' },
    ]);
    expect(ask.text).toContain('O valor mensal novo vale a partir do próximo depósito.');
    await send('confirmar');
    expect(envelopesService.update).toHaveBeenCalledWith('A', 'e1', { monthlyAmount: 250 });
    expect(envelopes.find((row) => row.id === 'e1')!.monthlyAmount).toBe('250.00');

    await send('apagar reserva lazer');
    await send('1');
    const done = await send('apagar');
    expect(done.kind).toBe('DONE');
    expect(done.text).toBe('Apaguei a reserva "Lazer". Os depósitos dessa reserva somem; os gastos ligados continuam no extrato, soltos.');
    expect(done.data?.envelopeId).toBe('e2');
    expect(envelopesService.remove).toHaveBeenCalledWith('A', 'e2');
    expect(envelopes.some((row) => row.id === 'e2')).toBe(false);
  });

  it('editar nome da reserva e aplicado; nome curto recusa', async () => {
    const { send, service, sessions, envelopesService } = buildService();
    await send('corrigir reserva gasolina');
    await send('1');
    const short = await send('nome x');
    expect(short.text).toBe('O nome precisa ter pelo menos 2 letras.');
    const preview = await send('nome Gasolina do trabalho');
    expect(preview.draft?.rows).toEqual([{ label: 'Nome', value: 'Gasolina → Gasolina do trabalho' }]);
    const session = sessions[sessions.length - 1];
    await service.confirmDraft('A', session.id, session.version);
    expect(envelopesService.update).toHaveBeenCalledWith('A', 'e1', { name: 'Gasolina do trabalho' });
  });

  it('conflito de updatedAt na reserva: nada gravado', async () => {
    const { send, envelopes, envelopesService } = buildService();
    await send('editar reserva gasolina');
    await send('1');
    await send('valor 300');
    envelopes.find((row) => row.id === 'e1')!.updatedAt = new Date('2026-11-15T09:00:00.000Z');
    const reply = await send('confirmar');
    expect(reply.text).toBe('Essa reserva mudou desde que você escolheu; refaça a busca.');
    expect(envelopesService.update).not.toHaveBeenCalled();
  });
});

describe('isolamento do editar/apagar metas e reservas (8b, secao 6)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rascunho de B nao e confirmavel por A nem apaga a meta de B', async () => {
    const { send, service, sessions, goalsService, goals } = buildService();
    await send('apagar meta viagem', 'B');
    await send('1', 'B');
    const bSession = sessions[0];
    expect(bSession.userId).toBe('B');
    const stolen = await service.confirmDraft('A', bSession.id, bSession.version, true);
    expect(stolen).toBeNull();
    await send('apagar', 'B');
    expect(goalsService.remove).toHaveBeenCalledTimes(1);
    expect(goalsService.remove).toHaveBeenCalledWith('B', 'g3');
    expect(goals.some((row) => row.id === 'g3')).toBe(false);
  });

  it('rascunho adulterado com id de B: A nao apaga a meta de B (leitura sempre com id + userId)', async () => {
    const { send, sessions, goals, goalsService } = buildService();
    await send('apagar meta casa');
    await send('1');
    const draft = sessions[0].draft as Row;
    const metaDeB = goals.find((row) => row.id === 'g3')!;
    draft.targetId = 'g3';
    draft.targetUpdatedAt = metaDeB.updatedAt.toISOString();
    const reply = await send('apagar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe('Não encontrei mais essa meta.');
    expect(goalsService.remove).not.toHaveBeenCalled();
    expect(goals.some((row) => row.id === 'g3')).toBe(true);
  });

  it('reserva de B nao aparece para A nem e editada por A', async () => {
    const { send, envelopesService } = buildService();
    const reply = await send('editar reserva gasolina de b');
    expect(reply.text).toBe('Não achei reserva com isso.');
    expect(envelopesService.update).not.toHaveBeenCalled();
  });
});
