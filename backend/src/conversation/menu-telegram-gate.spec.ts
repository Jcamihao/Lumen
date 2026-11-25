import { randomUUID } from 'crypto';
import { ConversationChannel } from '@prisma/client';
import { ConversationReply } from './conversation.types';
import { Engine, T0, USER_ID, World, buildEngine, seedWorld } from './isolation.fixture';

/**
 * Menu por botao no Telegram com a trava TELEGRAM_WRITES_ENABLED. O clique so abre o rascunho ou a
 * instrucao; a gravacao continua presa na confirmacao por texto, a mesma trava da mensagem comum.
 */
describe('menu por botao no Telegram e trava de escrita (12.1b)', () => {
  let world: World;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    world = seedWorld();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const click = (engine: Engine, nodeId: string): Promise<ConversationReply> =>
    engine.service.handleMenuAction({
      userId: USER_ID.A,
      channel: ConversationChannel.TELEGRAM,
      messageId: randomUUID(),
      nodeId,
      receivedAt: new Date(),
    });

  const say = (engine: Engine, text: string): Promise<ConversationReply> =>
    engine.service.handleMessage({
      userId: USER_ID.A,
      channel: ConversationChannel.TELEGRAM,
      messageId: randomUUID(),
      text,
      receivedAt: new Date(),
    });

  it('clique de folha de escrita com escrita do Telegram desligada abre o rascunho e nao grava', async () => {
    const engine = buildEngine(world, true, false);

    const reply = await click(engine, 'financas.despesa');

    expect(reply.kind).toBe('ASK_FIELD');
    expect(world.writeCount).toBe(0);
  });

  it('rascunho aberto por clique e confirmado por texto nao grava com a trava do Telegram desligada', async () => {
    const engine = buildEngine(world, true, false);
    await click(engine, 'financas.despesa');
    await say(engine, '50 mercado');

    const reply = await say(engine, 'confirmar');

    expect(reply.kind).toBe('INFO');
    expect(reply.state).toBe('AWAITING_CONFIRMATION');
    expect(world.writeCount).toBe(0);
  });

  it('controle: com a trava ligada, o mesmo caminho grava (o teste acima prova a trava, nao um caminho quebrado)', async () => {
    const engine = buildEngine(world, true, true);
    await click(engine, 'financas.despesa');
    await say(engine, '50 mercado');

    const reply = await say(engine, 'confirmar');

    expect(reply.kind).toBe('DONE');
    expect(world.writeCount).toBeGreaterThan(0);
  });
});
