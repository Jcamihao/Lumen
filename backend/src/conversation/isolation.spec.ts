/**
 * Testes de isolamento A/B/C do motor de conversa (item 6, regras invioláveis da spec de 2026-11-14).
 * Banco em memoria que RESPEITA o `where` (ver isolation.fixture.ts): se um filtro de `userId` sair do
 * codigo, algum teste aqui falha. A tabela de mutantes esta em .superpowers/sdd/isolamento-item-6/resultado-6.md.
 */
import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import { ConversationChannel } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ConversationController } from './conversation.controller';
import { ConversationReply } from './conversation.types';
import {
  Engine,
  JID,
  KEYWORD,
  SECRETS,
  T0,
  USER_ID,
  WHO,
  Who,
  World,
  buildEngine,
  forbiddenFor,
  seedWorld,
} from './isolation.fixture';
import { EnvelopeMonthChangedError, EnvelopeWriteUncertainError } from '../envelopes/conversation-write.types';

type Channel = 'APP' | 'WHATSAPP';

describe('Isolamento A/B/C do motor de conversa', () => {
  let world: World;
  let engine: Engine;
  let logged: string[];
  const spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    world = seedWorld();
    engine = buildEngine(world, true);
    logged = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
      spies.push(
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg))).join(' '));
        }),
      );
    }
  });

  afterEach(() => {
    jest.useRealTimers();
    spies.splice(0).forEach((spy) => spy.mockRestore());
  });

  const send = (who: Who, text: string, channel: Channel = 'APP', messageId: string = randomUUID()): Promise<ConversationReply> =>
    engine.service.handleMessage({
      userId: USER_ID[who],
      channel: channel as ConversationChannel,
      messageId,
      text,
      receivedAt: new Date(),
    });

  /** Abre um rascunho completo (aguardando confirmacao) e devolve id e versao. */
  async function openDraft(who: Who, text: string, channel: Channel = 'APP') {
    const reply = await send(who, text, channel);
    expect(reply.kind).toBe('CONFIRM_DRAFT');
    return { id: reply.draft!.draftId, version: reply.draft!.draftVersion, reply };
  }

  const expenseText = (who: Who) => `50 ${KEYWORD[who].category}`;

  function expectNoLeak(who: Who, value: unknown) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const forbidden of forbiddenFor(who)) {
      expect(text).not.toContain(forbidden);
    }
  }

  const sessionOf = (who: Who, channel: Channel) => world.sessions.find((row) => row.userId === USER_ID[who] && row.channel === channel);

  async function captureHttp(run: () => Promise<unknown>): Promise<HttpException> {
    try {
      await run();
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('esperava erro HTTP e nao houve');
  }

  describe('1. id de rascunho de outra conta (ler, confirmar, cancelar, reabrir)', () => {
    describe.each<Channel>(['APP', 'WHATSAPP'])('canal %s', (channel) => {
      it('confirmar com draftId e versao de B, sendo A: nao encontrado, nada grava, rascunho de B intacto', async () => {
        const draftB = await openDraft('B', expenseText('B'), channel);
        const before = JSON.stringify(sessionOf('B', channel));

        const reply = await engine.service.confirmDraft(USER_ID.A, draftB.id, draftB.version);

        expect(reply).toBeNull();
        expect(world.writeCount).toBe(0);
        expect(JSON.stringify(sessionOf('B', channel))).toBe(before);
      });

      it('cancelar com draftId de B, sendo A: nao encontrado e o rascunho de B continua', async () => {
        const draftB = await openDraft('B', expenseText('B'), channel);

        expect(await engine.service.cancelDraft(USER_ID.A, draftB.id)).toBeNull();

        expect(sessionOf('B', channel)).toBeDefined();
        expect(world.events.filter((row) => row.outcome === 'CANCELLED')).toHaveLength(0);
      });

      it('reabrir (getSession) de A nunca devolve rascunho de B', async () => {
        await openDraft('B', expenseText('B'), channel);
        await openDraft('C', expenseText('C'), channel);

        expect(await engine.service.getSession(USER_ID.A)).toEqual({ state: 'IDLE' });
      });

      it('resposta para id de outra conta e para id inexistente e a mesma, no servico e no controller', async () => {
        const draftB = await openDraft('B', expenseText('B'), channel);
        const missing = randomUUID();
        const controller = new ConversationController(engine.service);
        const asA = { sub: USER_ID.A } as never;

        expect(await engine.service.confirmDraft(USER_ID.A, draftB.id, draftB.version)).toEqual(
          await engine.service.confirmDraft(USER_ID.A, missing, draftB.version),
        );
        const foreignConfirm = await captureHttp(() => controller.confirm(asA, { draftId: draftB.id, draftVersion: draftB.version }));
        const missingConfirm = await captureHttp(() => controller.confirm(asA, { draftId: missing, draftVersion: draftB.version }));
        expect(foreignConfirm).toBeInstanceOf(NotFoundException);
        expect(foreignConfirm.getStatus()).toBe(404);
        expect(foreignConfirm.getResponse()).toEqual(missingConfirm.getResponse());

        const foreignCancel = await captureHttp(() => controller.cancel(asA, { draftId: draftB.id }));
        const missingCancel = await captureHttp(() => controller.cancel(asA, { draftId: missing }));
        expect(foreignCancel.getStatus()).toBe(404);
        expect(foreignCancel.getResponse()).toEqual(missingCancel.getResponse());
        expect(sessionOf('B', channel)).toBeDefined();
      });

      it('A confirma com o draftId de B e a versao de A: tambem nao encontrado, e o rascunho proprio de A nao e consumido', async () => {
        const draftA = await openDraft('A', expenseText('A'), channel);
        const draftB = await openDraft('B', expenseText('B'), channel);

        expect(await engine.service.confirmDraft(USER_ID.A, draftB.id, draftA.version)).toBeNull();
        expect(await engine.service.confirmDraft(USER_ID.B, draftA.id, draftB.version)).toBeNull();

        expect(world.writeCount).toBe(0);
        expect(sessionOf('A', channel)).toBeDefined();
        expect(sessionOf('B', channel)).toBeDefined();
      });

      it('a conta dona confirma o proprio rascunho normalmente (controle positivo)', async () => {
        const draftB = await openDraft('B', expenseText('B'), channel);

        const reply = await engine.service.confirmDraft(USER_ID.B, draftB.id, draftB.version);

        expect(reply?.kind).toBe('DONE');
        expect(world.snapshot(USER_ID.B).transactions).toHaveLength(3);
        expect(world.snapshot(USER_ID.A).transactions).toHaveLength(2);
      });
    });
  });

  describe('2. userId trocado no corpo', () => {
    it('/conversation/message com userId de B no corpo: o rascunho nasce na conta do JWT', async () => {
      const controller = new ConversationController(engine.service);
      const dto = { messageId: randomUUID(), text: expenseText('A'), userId: USER_ID.B, accountId: USER_ID.B } as never;

      await controller.message({ sub: USER_ID.A } as never, dto);

      expect(sessionOf('A', 'APP')).toBeDefined();
      expect(sessionOf('B', 'APP')).toBeUndefined();
      expect(world.events.every((row) => row.userId === USER_ID.A)).toBe(true);
    });

    it('/confirm e /cancel com userId de B no corpo: agem so na conta do JWT', async () => {
      const controller = new ConversationController(engine.service);
      const draftA = await openDraft('A', expenseText('A'));
      const draftB = await openDraft('B', expenseText('B'));

      await captureHttp(() => controller.confirm({ sub: USER_ID.A } as never, { draftId: draftB.id, draftVersion: draftB.version, userId: USER_ID.B } as never));
      await captureHttp(() => controller.cancel({ sub: USER_ID.A } as never, { draftId: draftB.id, userId: USER_ID.B } as never));
      expect(sessionOf('B', 'APP')).toBeDefined();
      expect(world.writeCount).toBe(0);

      const done = await controller.confirm({ sub: USER_ID.A } as never, { draftId: draftA.id, draftVersion: draftA.version, userId: USER_ID.B } as never);
      expect(done.kind).toBe('DONE');
      expect(world.snapshot(USER_ID.A).transactions).toHaveLength(3);
      expect(world.snapshot(USER_ID.B).transactions).toHaveLength(2);
    });
  });

  describe('3. idempotencia: mesma mensagem e confirmar repetido', () => {
    it('mesma mensagem duas vezes: a segunda e DUPLICATE e nao cria outro rascunho nem evento', async () => {
      const messageId = randomUUID();
      const first = await send('A', expenseText('A'), 'APP', messageId);
      const eventsAfterFirst = world.events.length;

      const second = await send('A', expenseText('A'), 'APP', messageId);

      expect(first.kind).toBe('CONFIRM_DRAFT');
      expect(second.kind).toBe('DUPLICATE');
      expect(world.events).toHaveLength(eventsAfterFirst);
      expect(world.sessions.filter((row) => row.userId === USER_ID.A)).toHaveLength(1);
    });

    it('o mesmo messageId em canais diferentes da mesma conta nao colide: os dois processam', async () => {
      const messageId = 'mesmo-id-nos-dois-canais';
      const app = await send('A', expenseText('A'), 'APP', messageId);
      const whatsapp = await send('A', expenseText('A'), 'WHATSAPP', messageId);

      expect(app.kind).toBe('CONFIRM_DRAFT');
      expect(whatsapp.kind).toBe('CONFIRM_DRAFT');
    });

    it('o mesmo messageId em contas diferentes nao colide: as duas processam', async () => {
      const messageId = 'mesma-key-id';
      const a = await send('A', expenseText('A'), 'WHATSAPP', messageId);
      const b = await send('B', expenseText('B'), 'WHATSAPP', messageId);

      expect(a.kind).toBe('CONFIRM_DRAFT');
      expect(b.kind).toBe('CONFIRM_DRAFT');
    });

    it('"confirmar" duas vezes em sequencia: grava uma vez so', async () => {
      await openDraft('A', expenseText('A'), 'WHATSAPP');

      const first = await send('A', 'confirmar', 'WHATSAPP');
      const second = await send('A', 'confirmar', 'WHATSAPP');

      expect(first.kind).toBe('DONE');
      expect(second.kind).not.toBe('DONE');
      expect(world.domainWrites.filter((call) => call.method === 'transactions.create')).toHaveLength(1);
    });

    it('10 confirmacoes em paralelo (botao e mensagens de WhatsApp misturados): exatamente 1 gravacao', async () => {
      const draft = await openDraft('A', expenseText('A'), 'WHATSAPP');

      const replies = await Promise.all([
        ...Array.from({ length: 5 }, () => engine.service.confirmDraft(USER_ID.A, draft.id, draft.version)),
        ...Array.from({ length: 5 }, () => send('A', 'confirmar', 'WHATSAPP')),
      ]);

      expect(replies.filter((reply) => reply?.kind === 'DONE')).toHaveLength(1);
      expect(world.domainWrites.filter((call) => call.method === 'transactions.create')).toHaveLength(1);
      expect(world.events.filter((row) => row.appliedKey)).toHaveLength(1);
      expect(sessionOf('A', 'WHATSAPP')).toBeUndefined();
    });

    it('confirmar o mesmo draftId e versao depois de gravado: nao encontrado', async () => {
      const draft = await openDraft('A', expenseText('A'));
      await engine.service.confirmDraft(USER_ID.A, draft.id, draft.version);

      expect(await engine.service.confirmDraft(USER_ID.A, draft.id, draft.version)).toBeNull();
      expect(world.domainWrites).toHaveLength(1);
    });
  });

  describe('5. conversas paralelas A/B/C', () => {
    async function flow(who: Who, round: number) {
      const replies: ConversationReply[] = [];
      const say = async (text: string) => {
        const reply = await send(who, text, round % 2 === 0 ? 'APP' : 'WHATSAPP');
        replies.push(reply);
        return reply;
      };

      const balance = await say('saldo');
      // O saldo muda a cada rodada (as despesas gravadas descontam); na primeira ele e o valor semeado.
      if (round === 0) expect(JSON.stringify(balance)).toContain(SECRETS[who].balance);
      expect(balance.kind).toBe('INFO');

      const draft = await say(expenseText(who));
      expect(draft.kind).toBe('CONFIRM_DRAFT');
      expect(draft.draft?.category).toBe(SECRETS[who].category);

      const goals = await say('metas');
      expect(JSON.stringify(goals)).toContain(SECRETS[who].goal);

      expect((await say('confirmar')).kind).toBe('DONE');

      const contribution = await say(`guardar 200 na ${KEYWORD[who].goal}`);
      expect(contribution.kind).toBe('CONFIRM_DRAFT');
      expect(JSON.stringify(contribution)).toContain(SECRETS[who].goal);
      expect((await say('sim')).kind).toBe('DONE');

      expect(JSON.stringify(await say('contas fixas'))).toContain(SECRETS[who].recurring);
      expect(JSON.stringify(await say(`gastos com ${KEYWORD[who].category}`))).toContain(SECRETS[who].category);
      await say('limite');
      await say('criar reserva 400 gasolina');
      await say('cancelar');
      await say('criar meta nova 2 mil');
      await say('cancelar');
      await say('saldo');
      return replies;
    }

    it('3 conversas intercaladas por varias rodadas: estado, resposta e dados ficam de cada conta', async () => {
      const all: Record<Who, ConversationReply[]> = { A: [], B: [], C: [] };
      for (let round = 0; round < 4; round += 1) {
        const results = await Promise.all(WHO.map((who) => flow(who, round)));
        WHO.forEach((who, index) => all[who].push(...results[index]));
      }

      for (const who of WHO) {
        for (const reply of all[who]) {
          expectNoLeak(who, reply);
        }
        // 4 rodadas x (1 despesa + 1 aporte) por conta.
        const own = world.snapshot(USER_ID[who]);
        expect(own.transactions).toHaveLength(2 + 4 * 2);
        expect(own.goals[0].current).toBe({ A: 1000, B: 2500, C: 300 }[who] + 4 * 200);
      }
      // Cada gravacao foi feita com o userId de quem pediu, e so existem sessoes (se sobrou alguma) de dono unico.
      const writesBy = (who: Who) => world.domainWrites.filter((call) => call.userId === USER_ID[who]).length;
      expect(writesBy('A')).toBe(8);
      expect(writesBy('B')).toBe(8);
      expect(writesBy('C')).toBe(8);
      expect(world.transactions.filter((row) => !WHO.some((who) => row.userId === USER_ID[who]))).toHaveLength(0);
      expect(world.events.every((row) => WHO.some((who) => row.userId === USER_ID[who]))).toBe(true);
      // Nenhum servico de dominio foi chamado com userId fora do ator das proprias linhas.
      expect(new Set(world.calls.map((call) => call.userId))).toEqual(new Set(WHO.map((who) => USER_ID[who])));
    });

    it('cada conta so le o que e dela: resposta de A nunca cita categoria, meta, saldo ou conta fixa de B ou C', async () => {
      await send('B', 'saldo');
      for (const who of WHO) {
        for (const text of ['saldo', 'resumo', 'metas', 'contas fixas', 'parcelas', 'reservas', 'limite', 'o que vence', `gastos com ${KEYWORD[who].category}`, 'gastos']) {
          expectNoLeak(who, await send(who, text));
        }
      }
    });

    it('A pedindo a categoria de B pelo nome: nao casa, nao vaza o nome nem o id', async () => {
      const reply = await send('A', `50 ${KEYWORD.B.category}`);

      expect(reply.kind).toBe('ASK_FIELD');
      expect(sessionOf('A', 'APP')?.draft.categoryId).toBeNull();
      expectNoLeak('A', reply);
      expect(sessionOf('A', 'APP')?.draft.categoryOptions).toEqual([]);
    });

    it('A responde com o nome da categoria de B a pergunta de categoria: cai em "sem categoria", nunca no id de B', async () => {
      await send('A', '50 xyzsemcategoria');
      const reply = await send('A', 'padaria beta');

      expect(reply.kind).toBe('CONFIRM_DRAFT');
      expect(sessionOf('A', 'APP')?.draft.categoryId).toBeNull();
      expectNoLeak('A', reply);
    });

    it('gasto por categoria: a transacao de B apontando para a categoria de A nao entra na soma de A', async () => {
      world.transactions.push({ id: 'tx-B-orfa', userId: USER_ID.B, type: 'EXPENSE', amount: 999, date: new Date('2026-11-05T00:00:00.000Z'), categoryId: 'cat-A-main' });

      const reply = await send('A', `gastos com ${KEYWORD.A.category}`);

      expect(JSON.stringify(reply)).toContain('8.765,44');
      expect(JSON.stringify(reply)).not.toContain('9.764,44');
    });

    it('gasto por categoria: categoria homonima de B nao se mistura com a de A', async () => {
      world.categories.push({ id: 'cat-B-mercado', userId: USER_ID.B, name: 'Mercado Beta', type: 'EXPENSE' });
      world.transactions.push({ id: 'tx-B-mercado', userId: USER_ID.B, type: 'EXPENSE', amount: 321, date: new Date('2026-11-05T00:00:00.000Z'), categoryId: 'cat-B-mercado' });

      const reply = await send('A', `gastos com ${KEYWORD.A.category}`);

      expect(JSON.stringify(reply)).toContain(SECRETS.A.category);
      expect(JSON.stringify(reply)).toContain('8.765,44');
      expect(JSON.stringify(reply)).not.toContain('Mercado Beta');
    });

    it('nome de reserva de B nao conta como "nome repetido" para A', async () => {
      world.envelopes.push({ id: 'env-B', userId: USER_ID.B, name: 'gasolina', monthlyAmount: 100 });

      const reply = await send('A', 'criar reserva 400 gasolina');

      expect(reply.kind).toBe('CONFIRM_DRAFT');
    });
  });

  describe('6. D9: getSession entre APP e WHATSAPP', () => {
    it('B nunca recebe o rascunho WHATSAPP de A', async () => {
      await openDraft('A', expenseText('A'), 'WHATSAPP');

      expect(await engine.service.getSession(USER_ID.B)).toEqual({ state: 'IDLE' });
      expect(await engine.service.getSession(USER_ID.C)).toEqual({ state: 'IDLE' });
    });

    it('B com sessao APP e A so com WHATSAPP: A ve o rascunho WHATSAPP dela, nunca o APP de B', async () => {
      const draftB = await openDraft('B', expenseText('B'), 'APP');
      const draftA = await openDraft('A', expenseText('A'), 'WHATSAPP');

      const sessionA = await engine.service.getSession(USER_ID.A);

      expect(sessionA.draft?.draftId).toBe(draftA.id);
      expect(sessionA.draft?.draftId).not.toBe(draftB.id);
      expectNoLeak('A', sessionA);
    });

    it('A com sessao APP e WHATSAPP: devolve a APP', async () => {
      const whatsapp = await openDraft('A', expenseText('A'), 'WHATSAPP');
      const app = await openDraft('A', expenseText('A'), 'APP');

      const session = await engine.service.getSession(USER_ID.A);

      expect(session.draft?.draftId).toBe(app.id);
      expect(session.draft?.draftId).not.toBe(whatsapp.id);
    });

    it('A com sessao WHATSAPP e B com sessao APP: cada uma ve a sua', async () => {
      const draftA = await openDraft('A', expenseText('A'), 'WHATSAPP');
      const draftB = await openDraft('B', expenseText('B'), 'APP');

      expect((await engine.service.getSession(USER_ID.A)).draft?.draftId).toBe(draftA.id);
      expect((await engine.service.getSession(USER_ID.B)).draft?.draftId).toBe(draftB.id);
    });

    it('expirada = IDLE, em APP e em WHATSAPP; APP expirada cai para a WHATSAPP valida', async () => {
      await openDraft('A', expenseText('A'), 'APP');
      const whatsapp = await openDraft('A', expenseText('A'), 'WHATSAPP');
      sessionOf('A', 'APP')!.expiresAt = new Date(T0.getTime() - 1);

      expect((await engine.service.getSession(USER_ID.A)).draft?.draftId).toBe(whatsapp.id);

      sessionOf('A', 'WHATSAPP')!.expiresAt = new Date(T0.getTime() - 1);
      expect(await engine.service.getSession(USER_ID.A)).toEqual({ state: 'IDLE' });
    });

    it('rascunho WHATSAPP ainda em coleta (nao aguarda confirmacao) nao aparece no app', async () => {
      await send('A', '50 xyzsemcategoria', 'WHATSAPP');

      expect(await engine.service.getSession(USER_ID.A)).toEqual({ state: 'IDLE' });
    });

    it('rascunho forjado com categoria de B: o cartao mostra "sem categoria", nunca o nome de B', async () => {
      const draft = await openDraft('A', expenseText('A'));
      sessionOf('A', 'APP')!.draft.categoryId = 'cat-B-main';

      const session = await engine.service.getSession(USER_ID.A);

      expect(session.draft?.category).toBeNull();
      expectNoLeak('A', session);
      expect(draft.id).toBe(session.draft?.draftId);
    });

    it('opcoes forjadas com categoria e meta de B: a pergunta nao mostra o nome delas', async () => {
      await send('A', '50 xyzsemcategoria');
      sessionOf('A', 'APP')!.draft.categoryOptions = ['cat-B-main'];

      const reply = await send('A', '60 xyzoutro');

      expectNoLeak('A', reply);

      await send('A', 'cancelar');
      await send('A', 'guardar 200');
      const contribution = sessionOf('A', 'APP');
      if (contribution) {
        contribution.draft.goalOptions = ['goal-B', 'goal-A'];
        expectNoLeak('A', await send('A', 'criar meta qualquer'));
      }
    });
  });

  describe('defesa em profundidade: id de sessao ou evento de outra conta nunca e alterado', () => {
    // Metodos privados chamados direto com a sessao de A e o userId de B: o servico nao pode agir sobre a linha de A.
    const priv = () => engine.service as unknown as Record<string, (...args: unknown[]) => Promise<ConversationReply>>;

    it('applyDraft com userId de B sobre a sessao de A: nao reivindica, nao grava', async () => {
      await openDraft('A', expenseText('A'));
      const row = sessionOf('A', 'APP')!;

      const reply = await priv().applyDraft({ userId: USER_ID.B, session: row, messageId: null, now: new Date() });

      expect(reply.kind).toBe('DUPLICATE');
      expect(world.writeCount).toBe(0);
      expect(sessionOf('A', 'APP')).toBeDefined();
    });

    it('cancelSession e expireSession com userId de B sobre a sessao de A: a sessao de A fica', async () => {
      await openDraft('A', expenseText('A'));
      const row = sessionOf('A', 'APP')!;

      await priv().cancelSession(USER_ID.B, row, null);
      expect(sessionOf('A', 'APP')).toBeDefined();
      await priv().expireSession(USER_ID.B, row, null);
      expect(sessionOf('A', 'APP')).toBeDefined();
    });

    it('fillPendingField com userId de B sobre a sessao de A: nao atualiza o rascunho de A', async () => {
      await send('A', 'gastei mercado');
      const versionBefore = sessionOf('A', 'APP')!.version;

      // Copia da linha: o motor muda o rascunho em memoria antes de gravar; o que conta e o que ficou no banco.
      const reply = await priv().fillPendingField({
        input: { userId: USER_ID.B, channel: 'APP', messageId: randomUUID(), text: '50', receivedAt: new Date() },
        session: structuredClone(sessionOf('A', 'APP')!),
        text: '50',
      });

      expect(reply.kind).toBe('ERROR');
      expect(sessionOf('A', 'APP')?.version).toBe(versionBefore);
      expect(sessionOf('A', 'APP')?.draft.amountCents).toBe(0);
    });

    describe('atualizacao do evento da confirmacao: so a linha da propria conta (colisao de id simulada)', () => {
      async function setup(draftText: string) {
        await send('B', 'saldo', 'APP', 'evento-de-B');
        const eventB = world.events.find((row) => row.userId === USER_ID.B)!;
        const eventBBefore = JSON.stringify(eventB);
        const draft = await openDraft('A', draftText);
        world.appliedEventIdOverride = eventB.id;
        return { eventB, eventBBefore, draft };
      }

      it('sucesso: o resultado nao vai para o evento de B', async () => {
        const { eventB, eventBBefore, draft } = await setup(expenseText('A'));

        const reply = await engine.service.confirmDraft(USER_ID.A, draft.id, draft.version);

        expect(reply?.kind).toBe('DONE');
        expect(JSON.stringify(eventB)).toBe(eventBBefore);
      });

      it('falha inesperada: o evento de B nao recebe ERROR nem perde a chave', async () => {
        const { eventB, eventBBefore, draft } = await setup(expenseText('A'));
        world.services.transactions.create.mockRejectedValueOnce(new Error('banco caiu'));

        const reply = await engine.service.confirmDraft(USER_ID.A, draft.id, draft.version);

        expect(reply?.kind).toBe('ERROR');
        expect(JSON.stringify(eventB)).toBe(eventBBefore);
      });

      it('condicao revisavel (mes da reserva mudou): o evento de B nao muda', async () => {
        const { eventB, eventBBefore, draft } = await setup('criar reserva 400 gasolina');
        world.services.envelopes.createForConversation.mockRejectedValueOnce(new EnvelopeMonthChangedError('2026-12-01'));

        const reply = await engine.service.confirmDraft(USER_ID.A, draft.id, draft.version);

        expect(reply?.kind).toBe('CONFIRM_DRAFT');
        expect(JSON.stringify(eventB)).toBe(eventBBefore);
      });

      it('escrita incerta: o evento de B nao muda', async () => {
        const { eventB, eventBBefore, draft } = await setup('criar reserva 400 gasolina');
        world.services.envelopes.createForConversation.mockRejectedValueOnce(new EnvelopeWriteUncertainError());

        const reply = await engine.service.confirmDraft(USER_ID.A, draft.id, draft.version);

        expect(reply?.kind).toBe('ERROR');
        expect(JSON.stringify(eventB)).toBe(eventBBefore);
      });
    });
  });

  describe('7. logs e erros nao carregam dado de outra conta', () => {
    const SECRET_TEXT = 'saldo 7.777,77 de user-B e nota Padaria Beta ultrasecreto123';

    function expectCleanLogs() {
      const joined = logged.join('\n');
      for (const forbidden of [...forbiddenFor('A'), 'ultrasecreto123', 'nota ']) {
        expect(joined).not.toContain(forbidden);
      }
    }

    it('leitura que falha com mensagem cheia de dado alheio: resposta generica e log so com intencao e nome do erro', async () => {
      world.services.goals.list.mockRejectedValue(new Error(SECRET_TEXT));
      world.services.dashboard.getSummary.mockRejectedValue(new Error(SECRET_TEXT));
      world.services.creditCycle.getCurrent.mockRejectedValue(new Error(SECRET_TEXT));
      world.services.recurring.list.mockRejectedValue(new Error(SECRET_TEXT));

      for (const text of ['metas', 'saldo', 'limite', 'contas fixas', 'definir limite 5000']) {
        const reply = await send('A', text);
        expect(reply.kind).toBe('ERROR');
        expectNoLeak('A', reply);
        expect(JSON.stringify(reply)).not.toContain('ultrasecreto123');
      }
      expect(logged.length).toBeGreaterThan(0);
      expectCleanLogs();
    });

    it('gravacao recusada pelo dominio com texto de nota na mensagem: o texto nao chega ao usuario nem ao log', async () => {
      world.services.transactions.create.mockRejectedValueOnce(new HttpException(SECRET_TEXT, 400));
      const draft = await openDraft('A', expenseText('A'));

      const reply = await engine.service.confirmDraft(USER_ID.A, draft.id, draft.version);

      expect(reply?.kind).toBe('ERROR');
      expect(JSON.stringify(reply)).not.toContain('ultrasecreto123');
      expect(JSON.stringify(reply)).not.toContain('user-B');
      expectCleanLogs();
    });

    it('erro inesperado ao gravar: resposta generica, sem a mensagem do erro', async () => {
      world.services.transactions.create.mockRejectedValueOnce(new Error(SECRET_TEXT));
      const draft = await openDraft('A', expenseText('A'));

      const reply = await engine.service.confirmDraft(USER_ID.A, draft.id, draft.version);

      expect(reply?.kind).toBe('ERROR');
      expect(JSON.stringify(reply)).not.toContain('ultrasecreto123');
      expectCleanLogs();
    });

    it('o texto digitado nao vai para evento, sessao de outro canal nem log: nem em fluxo normal', async () => {
      await send('A', '50 mercado ultrasecreto123');
      await send('A', 'confirmar');
      await send('A', 'ultrasecreto123 para entender');

      expect(JSON.stringify(world.events)).not.toContain('ultrasecreto123');
      expectCleanLogs();
    });
  });

  describe('8. WHATSAPP_WRITES_ENABLED=false: nenhuma gravacao por mensagem do WhatsApp', () => {
    const DRAFTS: Array<[string, (who: Who) => string]> = [
      ['despesa', (who) => `50 ${KEYWORD[who].category}`],
      ['receita', () => 'recebi 100 salario'],
      ['meta', () => 'criar meta viagem2 3 mil'],
      ['cofrinho', () => 'criar cofrinho emergencia'],
      ['aporte', (who) => `guardar 200 na ${KEYWORD[who].goal}`],
      ['reserva', () => 'criar reserva 400 gasolina'],
      ['limite do cartao', () => 'definir limite do cartão 5000'],
      ['conta fixa', () => 'criar conta fixa 120 internet mensal primeiro 20/11/2026'],
      ['parcela', () => 'criar parcelado 1200 geladeira em 12x primeiro 20/11/2026'],
    ];
    const CONFIRMS = ['confirmar', 'Confirmar', 'CONFIRMAR', 'confirmár', 'Confirmar!', ' confirmar ', 'sim', 'SIM', 'Sim.', 'ok', 'OK', 'Ok!', '\tok\n', '  sim  ', 'confirmar\n'];

    it.each(DRAFTS)('rascunho de %s: nenhuma variacao de "confirmar" chega ao dominio', async (_name, text) => {
      engine.settings.writesEnabled = false;
      const reply = await send('A', text('A'), 'WHATSAPP');
      expect(reply.kind === 'CONFIRM_DRAFT' || reply.kind === 'ASK_FIELD').toBe(true);

      for (const confirm of CONFIRMS) {
        const answer = await send('A', confirm, 'WHATSAPP');
        expect(answer.kind).not.toBe('DONE');
      }

      expect(world.writeCount).toBe(0);
      expect(world.events.filter((row) => row.appliedKey || row.outcome === 'COMPLETED')).toHaveLength(0);
      expect(sessionOf('A', 'WHATSAPP')).toBeDefined();
    });

    it('controle: com a trava ligada o mesmo "confirmar" grava', async () => {
      engine.settings.writesEnabled = true;
      await send('A', expenseText('A'), 'WHATSAPP');

      expect((await send('A', 'confirmar', 'WHATSAPP')).kind).toBe('DONE');
      expect(world.writeCount).toBe(1);
    });

    it('importar nota, ajuda e leituras nao gravam, com e sem rascunho, com a trava desligada', async () => {
      engine.settings.writesEnabled = false;
      for (const text of ['importar nota', 'importar nota fiscal', 'ler nota', 'ajuda', 'saldo', 'metas']) {
        await send('A', text, 'WHATSAPP');
      }
      await send('A', expenseText('A'), 'WHATSAPP');
      for (const text of ['importar nota', 'ajuda', 'saldo', 'metas', 'ok', 'sim']) {
        await send('A', text, 'WHATSAPP');
      }
      expect(world.writeCount).toBe(0);
    });

    it('rascunho de A em WHATSAPP e "confirmar" de B em WHATSAPP: nao grava nada para ninguem', async () => {
      engine.settings.writesEnabled = false;
      await send('A', expenseText('A'), 'WHATSAPP');
      await send('B', 'confirmar', 'WHATSAPP');
      await send('B', 'sim', 'WHATSAPP');

      expect(world.writeCount).toBe(0);
      expect(sessionOf('A', 'WHATSAPP')).toBeDefined();
    });
  });

  describe('9. editar e apagar lancamento (8a): so a propria conta', () => {
    const addTx = (who: Who, id: string, description: string, amount: number, day = '2026-11-14') => {
      world.transactions.push({
        id,
        userId: USER_ID[who],
        type: 'EXPENSE',
        description,
        amount,
        date: new Date(`${day}T00:00:00.000Z`),
        categoryId: null,
        createdAt: T0,
        updatedAt: T0,
        recurringTransactionId: null,
        installmentPurchaseId: null,
        linkedGoalId: null,
        receiptScan: null,
      });
    };
    const sessionOf = (who: Who) => world.sessions.find((row) => row.userId === USER_ID[who]);

    it('a lista de A nao traz lancamento de B com o mesmo termo, e a de B so o dela', async () => {
      addTx('A', 'a-1', 'Mercado Teste A', 10);
      addTx('B', 'b-1', 'Mercado Teste B', 20);
      const forA = await send('A', 'apagar mercado teste');
      expect(forA.text).toContain('Mercado Teste A');
      expect(forA.text).not.toContain('Mercado Teste B');
      const forB = await send('B', 'apagar mercado teste');
      expect(forB.text).toContain('Mercado Teste B');
      expect(forB.text).not.toContain('Mercado Teste A');
    });

    it('apagar com id de B plantado na sessao de A: nao encontrado, igual ao inexistente, B intacto', async () => {
      addTx('A', 'a-1', 'Mercado Teste A', 10);
      addTx('B', 'b-1', 'Mercado Teste B', 20);
      const pickA = async () => {
        await send('A', 'apagar mercado teste');
        await send('A', '1');
      };
      await pickA();
      sessionOf('A')!.draft.targetId = 'b-1';
      const forged = await send('A', 'apagar');
      expect(forged.kind).toBe('ERROR');
      await pickA();
      sessionOf('A')!.draft.targetId = 'nao-existe';
      const missing = await send('A', 'apagar');
      expect(forged.text).toBe(missing.text);
      expect(world.transactions.some((tx) => tx.id === 'b-1')).toBe(true);
      expect(world.services.transactions.remove).not.toHaveBeenCalledWith(USER_ID.A, 'b-1');
    });

    it('editar com id de B plantado: B nao muda, resposta igual a do id inexistente', async () => {
      addTx('A', 'a-1', 'Mercado Teste A', 10);
      addTx('B', 'b-1', 'Mercado Teste B', 20);
      await send('A', 'corrigir mercado teste');
      await send('A', '1');
      sessionOf('A')!.draft.targetId = 'b-1';
      await send('A', 'valor 99');
      const forged = await send('A', 'confirmar');
      expect(forged.kind).toBe('ERROR');
      expect(world.transactions.find((tx) => tx.id === 'b-1')!.amount).toBe(20);
      expect(world.services.transactions.update).not.toHaveBeenCalledWith(USER_ID.A, 'b-1', expect.anything());
    });

    it('A confirma o rascunho de apagar de B (com id e versao de B): nao encontrado, nada apagado', async () => {
      addTx('B', 'b-1', 'Mercado Teste B', 20);
      await send('B', 'apagar mercado teste');
      await send('B', '1');
      const session = sessionOf('B')!;
      const result = await engine.service.confirmDraft(USER_ID.A, session.id, session.version);
      expect(result).toBeNull();
      expect(sessionOf('B')).toBeDefined();
      expect(world.transactions.some((tx) => tx.id === 'b-1')).toBe(true);
    });

    it('A confirma o apagar de B com a flag de apagar explicita: null igual ao inexistente, B intacto', async () => {
      addTx('B', 'b-1', 'Mercado Teste B', 20);
      await send('B', 'apagar mercado teste');
      await send('B', '1');
      const session = sessionOf('B')!;
      const forged = await engine.service.confirmDraft(USER_ID.A, session.id, session.version, true);
      const missing = await engine.service.confirmDraft(USER_ID.A, 'nao-existe', session.version, true);
      expect(forged).toBeNull();
      expect(forged).toEqual(missing);
      expect(sessionOf('B')).toBeDefined();
      expect(world.transactions.some((tx) => tx.id === 'b-1')).toBe(true);
      expect(world.services.transactions.remove).not.toHaveBeenCalled();
    });

    it('B confirma o proprio apagar com flag: so o item de B sai; A nao e tocado', async () => {
      addTx('A', 'a-1', 'Mercado Teste A', 10);
      addTx('B', 'b-1', 'Mercado Teste B', 20);
      await send('B', 'apagar mercado teste');
      await send('B', '1');
      const session = sessionOf('B')!;
      const reply = await engine.service.confirmDraft(USER_ID.B, session.id, session.version, true);
      expect(reply?.kind).toBe('DONE');
      expect(world.services.transactions.remove).toHaveBeenCalledWith(USER_ID.B, 'b-1');
      expect(world.transactions.some((tx) => tx.id === 'b-1')).toBe(false);
      expect(world.transactions.some((tx) => tx.id === 'a-1')).toBe(true);
    });

    it('cartao com id de B plantado (apagar e editar): linha neutra no turno e no GET, sem descricao nem valor de B', async () => {
      addTx('A', 'a-1', 'Mercado Teste A', 10);
      addTx('B', 'b-1', 'Segredo de B', 987.65);
      await send('A', 'apagar mercado teste');
      await send('A', '1');
      sessionOf('A')!.draft.targetId = 'b-1';
      const restoredDelete = await engine.service.getSession(USER_ID.A);
      expect(restoredDelete.draft?.rows).toEqual([{ label: 'Lançamento', value: 'escolhido' }]);
      expect(JSON.stringify(restoredDelete)).not.toMatch(/Segredo|987/);
      world.sessions.splice(0, world.sessions.length);
      await send('A', 'corrigir mercado teste');
      await send('A', '1');
      sessionOf('A')!.draft.targetId = 'b-1';
      sessionOf('A')!.draft.changes = { amountCents: 4500, categoryId: 'cat-B-main' };
      const restoredEdit = await engine.service.getSession(USER_ID.A);
      expect(restoredEdit.draft?.rows).toEqual([{ label: 'Lançamento', value: 'escolhido' }]);
      expect(JSON.stringify(restoredEdit)).not.toMatch(/Segredo|987/);
    });

    it('cartao de editar com categoria de B plantada na mudanca: nunca mostra o nome da categoria de B', async () => {
      addTx('A', 'a-1', 'Mercado Teste A', 10);
      await send('A', 'corrigir mercado teste');
      await send('A', '1');
      sessionOf('A')!.draft.changes = { categoryId: 'cat-B-main' };
      const restored = await engine.service.getSession(USER_ID.A);
      expect(restored.draft?.rows).toEqual([{ label: 'Categoria', value: 'sem categoria → sem categoria' }]);
    });

    it('logs do fluxo de apagar e editar nao carregam descricao nem valor', async () => {
      addTx('A', 'a-1', 'Descricao secreta XYZ', 777.77);
      await send('A', 'apagar secreta xyz');
      await send('A', '1');
      await send('A', 'apagar');
      await send('A', 'corrigir secreta xyz');
      await send('A', '1');
      await send('A', 'valor 12');
      expect(logged.join('\n')).not.toMatch(/secreta|777|XYZ/i);
    });
  });
});

describe('10. cartao no lancamento (9b-1): cartao de outra conta nunca casa nem aparece', () => {
  let world: World;
  let engine: Engine;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    world = seedWorld();
    engine = buildEngine(world, true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const send = (who: Who, text: string): Promise<ConversationReply> =>
    engine.service.handleMessage({ userId: USER_ID[who], channel: 'APP', messageId: randomUUID(), text, receivedAt: new Date() });
  const draftOf = (who: Who) => world.sessions.find((row) => row.userId === USER_ID[who])?.draft;

  it('A nao ve o Bradesco de B; "no itau" de A nao pega o Itau de B', async () => {
    const notFound = await send('A', '50 no cartao bradesco');
    expect(notFound.kind).toBe('ERROR');
    expect(notFound.text).toContain('Cartões: Nubank');
    expect(notFound.text).not.toContain('Bradesco');
    expect(world.sessions.some((row) => row.userId === USER_ID.A)).toBe(false);

    await send('A', '50 mercado no itau');
    expect(draftOf('A')).toMatchObject({ cardId: null, paymentMethod: null });
  });

  it('B usa o proprio cartao: o id gravado no rascunho e o de B', async () => {
    await send('B', '50 mercado no itau');
    expect(draftOf('B')).toMatchObject({ cardId: 'cr-B-itau', cardName: 'Itaú', paymentMethod: 'CREDIT' });
  });
});

describe('11. leitura por cartao e meus cartoes (9b-2): so cartao da propria conta', () => {
  let world: World;
  let engine: Engine;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    world = seedWorld();
    engine = buildEngine(world, true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const send = (who: Who, text: string): Promise<ConversationReply> =>
    engine.service.handleMessage({ userId: USER_ID[who], channel: 'APP', messageId: randomUUID(), text, receivedAt: new Date() });

  it('cartao de B nao casa para A: a resposta e a mesma do nome inexistente, e o ciclo nao e lido', async () => {
    const alheio = await send('A', 'cartao bradesco');
    const inexistente = await send('A', 'cartao picapau');
    expect(alheio.text).toContain('Cartões: Nubank');
    expect(alheio.text).not.toContain('Bradesco');
    expect(alheio.text.replace('"bradesco"', '"X"')).toBe(inexistente.text.replace('"picapau"', '"X"'));
    expect(world.calls.some((call) => call.method === 'creditCycle.getCycleForCard' && call.userId === USER_ID.A)).toBe(false);
  });

  it('"no/do X" de A com nome de cartao de B nao vira leitura (forma sem a palavra cartao)', async () => {
    const reply = await send('A', 'quanto sobrou no itau');
    expect(reply.text).not.toContain('Cartão:');
    expect(reply.text).not.toContain('Itaú');
    expect(reply.text).not.toContain('Bradesco');
  });

  it('B le o proprio cartao pelo nome e recebe o cartao dele, nunca o de A', async () => {
    const reply = await send('B', 'cartao Bradesco');
    expect(reply.text.startsWith('Cartão: Bradesco\n')).toBe(true);
    const nubankDeA = await send('B', 'cartao nubank');
    expect(nubankDeA.text).toContain('Cartões: Itaú, Bradesco');
    expect(nubankDeA.text).not.toContain('Nubank,');
  });

  it('"meus cartoes" lista so os do dono; conta sem cartao recebe a resposta curta', async () => {
    const a = await send('A', 'meus cartoes');
    expect(a.text).toBe('Seus cartões:\n- Nubank (padrão): fechamento dia 5, vencimento dia 12');
    const b = await send('B', 'meus cartoes');
    expect(b.text).toContain('- Itaú (padrão)');
    expect(b.text).toContain('- Bradesco');
    expect(b.text).not.toContain('Nubank');
    const c = await send('C', 'meus cartoes');
    expect(c.text).toBe('Você ainda não tem cartão ativo.');
    expect((await send('C', 'cartao Nubank')).text).toBe('Você ainda não tem cartão ativo.');
  });
});
