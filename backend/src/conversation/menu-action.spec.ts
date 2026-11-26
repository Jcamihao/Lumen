import { randomUUID } from 'crypto';
import { ConversationChannel, ConversationOutcome, ConversationState } from '@prisma/client';
import { ConversationReply } from './conversation.types';
import { Engine, T0, USER_ID, Who, World, buildEngine, expectNoLeakFor, seedWorld } from './isolation.fixture';

/** Menu por botao (12.1a) e saida universal, pelo motor real sobre o mundo fake de A, B e C. */
describe('menu por botao e saida universal (12.1a)', () => {
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

  const click = (who: Who, nodeId: string, messageId: string = randomUUID(), channel: ConversationChannel = 'APP') =>
    engine.service.handleMenuAction({ userId: USER_ID[who], channel, messageId, nodeId, receivedAt: new Date() });

  const say = (who: Who, text: string, messageId: string = randomUUID()): Promise<ConversationReply> =>
    engine.service.handleMessage({ userId: USER_ID[who], channel: ConversationChannel.APP, messageId, text, receivedAt: new Date() });

  const lastEventOf = (who: Who) => world.events.filter((row) => row.userId === USER_ID[who]).at(-1);

  describe('navegacao', () => {
    it('raiz: menu inicial com as cinco areas, sem Voltar nem Menu, e registra menu_open', async () => {
      const reply = await click('A', 'menu');

      expect(reply).toMatchObject({ kind: 'MENU', state: 'IDLE', menu: { nodeId: 'menu' } });
      expect(reply.menu?.title).toMatch(/^(Bom dia|Boa tarde|Boa noite)! ✨ Lumen · o que vamos fazer hoje\?\n/);
      expect(reply.menu?.title).toContain('💰 Finanças: lançar, consultar, editar e apagar');
      expect(reply.menu?.options.map((option) => option.id)).toEqual(['inicio', 'financas', 'cartao', 'metas', 'ajuda']);
      expect(reply.menu?.backId).toBeUndefined();
      expect(reply.menu?.topId).toBeUndefined();
      expect(reply.text).toContain('1. 🏠 Início');
      expect(lastEventOf('A')).toMatchObject({ intent: 'menu_open', outcome: ConversationOutcome.RECOGNIZED });
    });

    it('area: lista numerada com a frase para digitar, Voltar e Menu, e registra menu_nav', async () => {
      const reply = await click('A', 'financas');

      expect(reply).toMatchObject({ kind: 'MENU', menu: { nodeId: 'financas', backId: 'menu', topId: 'menu' } });
      expect(reply.menu?.options).toHaveLength(8);
      expect(reply.text).toContain('1. 🛒 Lançar despesa: registrar um gasto — "gastei 50 no mercado"');
      expect(reply.text).toContain('3. 🏷️ Categorias: ver, criar, editar e excluir');
      expect(lastEventOf('A')).toMatchObject({ intent: 'menu_nav:financas' });
    });

    it('id desconhecido cai no menu inicial, sem erro, sem gravar e sem vazar nada', async () => {
      const reply = await click('A', '../../../etc/passwd');

      expect(reply).toMatchObject({ kind: 'MENU', menu: { nodeId: 'menu' } });
      expect(world.writeCount).toBe(0);
      expectNoLeakFor('A', reply.text);
    });

    it('clique com rascunho expirado avisa que expirou (nao navega com sessao morta)', async () => {
      await say('A', '50 mercado');
      jest.setSystemTime(new Date(T0.getTime() + 6 * 60_000));

      const reply = await click('A', 'financas');

      expect(reply.kind).toBe('EXPIRED');
    });

    it('navegar com rascunho aberto nao apaga o rascunho', async () => {
      await say('A', '50 mercado');
      const before = world.sessions.map((row) => row.id);

      const reply = await click('A', 'financas');

      expect(reply.state).toBe(ConversationState.AWAITING_CONFIRMATION);
      expect(world.sessions.map((row) => row.id)).toEqual(before);
    });
  });

  describe('folhas', () => {
    it('folha de leitura executa a frase do motor e acrescenta a dica com o exemplo natural', async () => {
      const reply = await click('A', 'inicio.saldo');

      expect(reply.kind).toBe('INFO');
      expect(reply.data?.balanceCents).toBe(123456);
      expect(reply.text).toContain('Dica: da próxima vez, é só dizer: como está o meu saldo?');
      expect(lastEventOf('A')).toMatchObject({ intent: 'balance', outcome: ConversationOutcome.RECOGNIZED });
      expectNoLeakFor('A', reply.text);
    });

    it('folha de escrita por frase abre o rascunho guiado e nao grava nada', async () => {
      const reply = await click('A', 'financas.despesa');

      expect(reply.kind).toBe('ASK_FIELD');
      expect(reply.text).toContain('Dica: da próxima vez, é só dizer: gastei 50 no mercado');
      expect(world.writeCount).toBe(0);
      expect(world.sessions).toHaveLength(1);
    });

    it('folha de instrucao responde a frase pronta com a dica, sem sessao e sem gravar', async () => {
      const reply = await click('A', 'cartao.criar');

      expect(reply.kind).toBe('HELP');
      expect(reply.state).toBe('IDLE');
      expect(reply.text).toContain('Para criar um cartão, diga: criar cartão Nubank.');
      expect(reply.text).toContain('Dica: da próxima vez, é só dizer: criar cartão Nubank');
      expect(world.sessions).toHaveLength(0);
      expect(world.writeCount).toBe(0);
      expect(lastEventOf('A')).toMatchObject({ intent: 'menu_nav:cartao.criar' });
    });

    it('folha de instrucao de meta nao grava (guardar nao abre rascunho sozinho)', async () => {
      const reply = await click('B', 'metas.guardar');

      expect(reply.kind).toBe('HELP');
      expect(reply.text).toContain('coloquei 200 na minha caixinha');
      expect(world.writeCount).toBe(0);
      expect(world.sessions).toHaveLength(0);
    });
  });

  describe('idempotencia e isolamento', () => {
    it('mesmo clique (mesmo messageId) duas vezes: a segunda e DUPLICATE e nao age de novo', async () => {
      const messageId = 'clique-1';
      const first = await click('A', 'inicio.saldo', messageId);
      const second = await click('A', 'inicio.saldo', messageId);

      expect(first.kind).toBe('INFO');
      expect(second.kind).toBe('DUPLICATE');
      expect(world.events.filter((row) => row.messageId === messageId)).toHaveLength(1);
    });

    it('mesmo messageId em navegacao e em folha de instrucao tambem e DUPLICATE', async () => {
      await click('A', 'financas', 'nav-1');
      await click('A', 'cartao.criar', 'instr-1');

      expect((await click('A', 'financas', 'nav-1')).kind).toBe('DUPLICATE');
      expect((await click('A', 'cartao.criar', 'instr-1')).kind).toBe('DUPLICATE');
      expect(world.events.filter((row) => row.messageId === 'nav-1' || row.messageId === 'instr-1')).toHaveLength(2);
    });

    it('o mesmo messageId de outra conta nao e duplicado e nunca age na conta de quem clicou primeiro', async () => {
      const messageId = 'clique-compartilhado';
      await click('A', 'financas.despesa', messageId);
      const reply = await click('B', 'inicio.saldo', messageId);

      expect(reply.kind).toBe('INFO');
      expectNoLeakFor('B', reply.text);
      expect(world.events.filter((row) => row.userId === USER_ID.A && row.messageId === messageId)).toHaveLength(1);
      expect(world.events.filter((row) => row.userId === USER_ID.B)).toHaveLength(1);
    });

    it('clique de B nunca mexe no rascunho de A', async () => {
      await say('A', '50 mercado');
      const aBefore = JSON.stringify(world.sessions.filter((row) => row.userId === USER_ID.A));

      await click('B', 'financas');
      await click('B', 'cartao.criar');
      await click('B', 'inicio.saldo');

      expect(JSON.stringify(world.sessions.filter((row) => row.userId === USER_ID.A))).toBe(aBefore);
      expect(world.sessions.filter((row) => row.userId === USER_ID.B)).toHaveLength(0);
    });
  });

  describe('saida universal', () => {
    it('"voltar" sem rascunho mostra o menu inicial', async () => {
      const reply = await say('A', 'voltar');

      expect(reply).toMatchObject({ kind: 'MENU', state: 'IDLE', menu: { nodeId: 'menu' } });
      expect(reply.text).toMatch(/^(Bom dia|Boa tarde|Boa noite)! ✨ Lumen · o que vamos fazer hoje\?/);
      expect(lastEventOf('A')).toMatchObject({ intent: 'menu_open' });
    });

    it('"menu", "inicio", "comecar" e "start" sem rascunho mostram o menu', async () => {
      for (const word of ['menu', 'Início', 'começar', 'start']) {
        expect({ word, kind: (await say('A', word)).kind }).toEqual({ word, kind: 'MENU' });
      }
    });

    it('Categorias e um submenu com quatro opcoes; criar categoria abre o rascunho guiado', async () => {
      const area = await click('A', 'financas.categorias');
      expect(area.menu?.options.map((option) => option.id)).toEqual([
        'financas.categorias.ver',
        'financas.categorias.criar',
        'financas.categorias.editar',
        'financas.categorias.excluir',
      ]);
      expect(area.menu?.backId).toBe('financas');
      expect(area.menu?.title).toContain('Aqui você organiza as categorias');
      const created = await click('A', 'financas.categorias.criar');
      expect(created.kind).toBe('ASK_FIELD');
      expect(created.text).toContain('Qual o nome da nova categoria?');
      expect(world.writeCount).toBe(0);
    });

    it('apos tocar em Lancar despesa, frase completa com 3$ preenche valor e descricao', async () => {
      await click('A', 'financas.despesa');

      const reply = await say('A', 'Gastei 3$ tomando café na padaria');

      expect(reply.text).not.toContain('Não encontrei o valor');
      expect(world.sessions).toHaveLength(1);
      expect(world.sessions[0].draft).toMatchObject({ amountCents: 300 });
      expect(String((world.sessions[0].draft as { description: string }).description).toLowerCase()).toContain('padaria');
    });

    it('saudacoes sem rascunho mostram o menu', async () => {
      for (const word of ['oi', 'Oiieee', 'bom dia', 'opa', 'olá']) {
        expect({ word, kind: (await say('A', word)).kind }).toEqual({ word, kind: 'MENU' });
      }
    });

    it('saudacao com rascunho aberto nao cancela o rascunho', async () => {
      await say('A', '50 mercado');

      const reply = await say('A', 'oi');

      expect(reply.kind).not.toBe('MENU');
      expect(world.sessions).toHaveLength(1);
    });

    it('"cancelar" sem nada aberto responde "Nada para cancelar." e mostra o menu', async () => {
      const reply = await say('A', 'cancelar');

      expect(reply.kind).toBe('MENU');
      expect(reply.text.startsWith('Nada para cancelar.\n\n')).toBe(true);
      expect(reply.menu?.lead).toBe('Nada para cancelar.');
      expect(world.writeCount).toBe(0);
    });

    it('"cancela" com rascunho aberto cancela (texto de sempre) e anexa o menu inicial', async () => {
      await say('A', '50 mercado');

      const reply = await say('A', 'cancela');

      expect(reply.kind).toBe('CANCELLED');
      expect(reply.text).toContain('Rascunho cancelado. Nada foi gravado.');
      expect(reply.text).toContain('✨ Lumen · o que vamos fazer hoje?');
      expect(reply.menu?.nodeId).toBe('menu');
      expect(reply.menu?.lead).toBe('Rascunho cancelado. Nada foi gravado.');
      expect(world.sessions).toHaveLength(0);
      expect(world.writeCount).toBe(0);
    });

    it('"menu" com rascunho aberto tambem cancela e volta ao inicio', async () => {
      await say('A', '50 mercado');

      const reply = await say('A', 'menu');

      expect(reply).toMatchObject({ kind: 'CANCELLED', menu: { nodeId: 'menu' } });
      expect(world.sessions).toHaveLength(0);
    });

    it('"ok", "sim" e "nao" nao saem sem rascunho', async () => {
      for (const word of ['ok', 'sim', 'nao']) {
        expect({ word, kind: (await say('A', word)).kind }).toEqual({ word, kind: 'HELP' });
      }
    });

    it('"nao" com rascunho aguardando confirmacao nao cancela', async () => {
      await say('A', '50 mercado');

      const reply = await say('A', 'nao');

      expect(reply.kind).not.toBe('CANCELLED');
      expect(world.sessions).toHaveLength(1);
      expect(world.sessions[0].state).toBe(ConversationState.AWAITING_CONFIRMATION);
    });

    it('palavra de saida no meio de frase maior nao vale', async () => {
      const reply = await say('A', 'voltar pro saldo');

      expect(reply.kind).not.toBe('MENU');
    });

    it('"ajuda" lembra que da para falar direto ou usar "menu"', async () => {
      const reply = await say('A', 'ajuda');

      expect(reply.kind).toBe('HELP');
      expect(reply.text).toContain('menu');
      expect(reply.text).toContain('como está o meu saldo?');
    });
  });
});
