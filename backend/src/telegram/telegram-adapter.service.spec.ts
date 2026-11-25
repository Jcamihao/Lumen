import { ConfigService } from '@nestjs/config';
import { TelegramAdapterService, TELEGRAM_TEXTS } from './telegram-adapter.service';
import { TelegramInbound } from './telegram-bot.client';

type Row = Record<string, any>;

function buildStack(options: { rateHits?: number | null; linkHits?: number | null; hintHits?: number | null } = {}) {
  const state: Row[] = [];
  const prisma = {
    telegramBotState: {
      findUnique: jest.fn(async () => state[0] ?? null),
      upsert: jest.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        if (state[0]) Object.assign(state[0], update);
        else state.push({ ...create });
        return state[0];
      }),
    },
  };

  const cache = {
    hitRateLimitWindow: jest.fn(async (key: string) => {
      if (key.startsWith('telegram:rate:')) return options.rateHits === null ? null : { hits: options.rateHits ?? 1 };
      if (key.startsWith('telegram:linkfail:')) return options.linkHits === null ? null : { hits: options.linkHits ?? 1 };
      if (key.startsWith('telegram:hint:')) return { hits: options.hintHits ?? 1 };
      return null;
    }),
  };

  const links = {
    findUserIdByChatId: jest.fn(async (chatId: string) => (chatId === '111' ? 'A' : null)),
    redeem: jest.fn(async () => true),
    unlinkByUserId: jest.fn(async () => undefined),
  };

  const conversation = { handleMessage: jest.fn(async (): Promise<Record<string, unknown>> => ({ kind: 'INFO', state: 'IDLE', text: 'Saldo: R$ 10,00' })) };
  const client = {
    sendMessage: jest.fn(async () => undefined),
    setMyCommands: jest.fn(async () => undefined),
    getUpdates: jest.fn(async (_offset?: number): Promise<unknown[]> => []),
  };
  const config = {
    get: (key: string) => {
      const values: Record<string, unknown> = {
        'telegram.enabled': true,
        'telegram.botToken': 'TOKEN',
        'telegram.pollTimeoutS': 25,
      };
      return values[key];
    },
  } as unknown as ConfigService;

  const adapter = new TelegramAdapterService(prisma as never, config, cache as never, links as never, conversation as never, client as never);
  return { adapter, prisma, cache, links, conversation, client };
}

const inbound = (overrides: Partial<TelegramInbound> = {}): TelegramInbound => ({
  updateId: 7,
  chatId: '111',
  messageId: 'tg-7',
  text: 'saldo',
  hasText: true,
  ...overrides,
});

describe('TelegramAdapterService (contrato 10)', () => {
  it('chat vinculado cai no motor com channel TELEGRAM e messageId do update', async () => {
    const { adapter, conversation, client } = buildStack();

    await adapter.process(inbound());

    expect(conversation.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'A', channel: 'TELEGRAM', messageId: 'tg-7', text: 'saldo' }),
    );
    expect(client.sendMessage).toHaveBeenCalledWith('111', 'Saldo: R$ 10,00', undefined);
  });

  it('rascunho espera confirmacao: teclado vai so na ultima parte (D4)', async () => {
    const { adapter, conversation, client } = buildStack();
    conversation.handleMessage.mockResolvedValueOnce({
      kind: 'CONFIRM_DRAFT',
      state: 'AWAITING_CONFIRMATION',
      text: 'Confirmar lancamento? Responda "confirmar" ou "cancelar".',
      draft: { rows: [] },
      quickReplies: ['confirmar', 'cancelar'],
    } as never);

    await adapter.process(inbound({ text: '50 mercado' }));

    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).toHaveBeenCalledWith('111', expect.any(String), ['confirmar', 'cancelar']);
  });

  it('DUPLICATE nao reenvia (a primeira resposta ja saiu)', async () => {
    const { adapter, conversation, client } = buildStack();
    conversation.handleMessage.mockResolvedValueOnce({ kind: 'DUPLICATE', state: 'IDLE', text: '' });

    await adapter.process(inbound());

    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('limite de 20/min por chat silencia sem tocar no motor', async () => {
    const { adapter, conversation, client } = buildStack({ rateHits: 21 });

    await adapter.process(inbound());

    expect(conversation.handleMessage).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('vigesima mensagem ainda e processada; o corte e depois de 20', async () => {
    const { adapter, conversation } = buildStack({ rateHits: 20 });

    await adapter.process(inbound());

    expect(conversation.handleMessage).toHaveBeenCalled();
  });

  it('chat sem vinculo: codigo certo vincula e confirma', async () => {
    const { adapter, links, client } = buildStack();

    await adapter.process(inbound({ chatId: '555', text: 'K7M2PQ4X' }));

    expect(links.redeem).toHaveBeenCalledWith('555', 'K7M2PQ4X');
    expect(client.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_TEXTS.linked, undefined);
  });

  it('chat sem vinculo: 6a tentativa de codigo em 10 min nao resgata nem responde', async () => {
    const { adapter, links, client } = buildStack({ linkHits: 6 });

    await adapter.process(inbound({ chatId: '555', text: 'K7M2PQ4X' }));

    expect(links.redeem).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('chat sem vinculo: quinta tentativa em 10 min ainda e validada', async () => {
    const { adapter, links } = buildStack({ linkHits: 5 });

    await adapter.process(inbound({ chatId: '555', text: 'K7M2PQ4X' }));

    expect(links.redeem).toHaveBeenCalledWith('555', 'K7M2PQ4X');
  });

  it('chat sem vinculo: orientacao uma vez por hora; na hora nao repete', async () => {
    const first = buildStack({ hintHits: 1 });
    await first.adapter.process(inbound({ chatId: '555', text: 'oi quem e voce' }));
    expect(first.client.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_TEXTS.hint, undefined);

    const later = buildStack({ hintHits: 2 });
    await later.adapter.process(inbound({ chatId: '555', text: 'oi de novo' }));
    expect(later.client.sendMessage).not.toHaveBeenCalled();
  });

  it('sem Redis, desconhecido fica mudo e vinculado segue funcionando (falha fechada)', async () => {
    const semRedis = buildStack({ rateHits: null });
    await semRedis.adapter.process(inbound({ chatId: '555', text: 'oi' }));
    expect(semRedis.client.sendMessage).not.toHaveBeenCalled();

    const vinculado = buildStack({ rateHits: null });
    await vinculado.adapter.process(inbound());
    expect(vinculado.client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('midia de vinculado manda a orientacao de Importacoes sem tocar no motor', async () => {
    const { adapter, conversation, client } = buildStack();

    await adapter.process(inbound({ text: '', hasText: false }));

    expect(conversation.handleMessage).not.toHaveBeenCalled();
    expect(client.sendMessage).toHaveBeenCalledWith('111', TELEGRAM_TEXTS.media, undefined);
  });

  it('"desvincular telegram" desvincula, com espacos e caixa diferentes tambem', async () => {
    const { adapter, links, client } = buildStack();

    await adapter.process(inbound({ text: '  Desvincular  TELEGRAM ' }));

    expect(links.unlinkByUserId).toHaveBeenCalledWith('A');
    expect(client.sendMessage).toHaveBeenCalledWith('111', TELEGRAM_TEXTS.unlinked, undefined);
  });

  it('texto so com espacos e texto gigante respondem curto, sem chegar ao motor', async () => {
    const vazio = buildStack();
    await vazio.adapter.process(inbound({ text: '   ' }));
    expect(vazio.client.sendMessage).toHaveBeenCalledWith('111', TELEGRAM_TEXTS.empty, undefined);

    const gigante = buildStack();
    await gigante.adapter.process(inbound({ text: 'a'.repeat(1001) }));
    expect(gigante.client.sendMessage).toHaveBeenCalledWith('111', TELEGRAM_TEXTS.tooLong, undefined);
    expect(gigante.conversation.handleMessage).not.toHaveBeenCalled();
  });

  it('resposta em varias partes: so a ultima carrega o teclado (D4)', async () => {
    const { adapter, conversation, client } = buildStack();
    conversation.handleMessage.mockResolvedValueOnce({
      kind: 'CONFIRM_DRAFT',
      state: 'AWAITING_CONFIRMATION',
      text: 'linha\n'.repeat(1500),
      draft: { rows: [{ label: 'Valor', value: 'R$ 10,00' }] },
      quickReplies: ['confirmar', 'cancelar'],
    } as never);

    await adapter.process(inbound({ text: '50 mercado' }));

    expect(client.sendMessage.mock.calls.length).toBeGreaterThan(1);
    const calls = client.sendMessage.mock.calls as unknown as [string, string, string[] | undefined][];
    for (const call of calls.slice(0, -1)) expect(call[2]).toBeUndefined();
    expect(calls[calls.length - 1][2]).toEqual(['confirmar', 'cancelar']);
  });

  it('falha no meio do envio para as partes restantes (loga e nao lanca)', async () => {
    const { adapter, client } = buildStack();
    client.sendMessage.mockRejectedValueOnce(new Error('http 429'));

    await expect(adapter.send('111', ['parte 1', 'parte 2'])).resolves.toBeUndefined();

    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('long polling: offset e ciclo (D2)', () => {
  it('processa em ordem, avanca o offset mesmo com update descartado e persiste por lote', async () => {
    const { adapter, client, prisma, conversation } = buildStack();
    const updates = [
      { update_id: 10, message: { message_id: 1, chat: { id: 111, type: 'private' }, text: 'saldo' } },
      { update_id: 11, edited_message: { message_id: 1, text: 'mudado' } }, // descartado, mas o offset passa na frente
      { update_id: 12, message: { message_id: 2, chat: { id: 111, type: 'private' }, text: 'gastos' } },
    ];
    let calls = 0;
    client.getUpdates.mockImplementation(async (offset: number) => {
      calls += 1;
      if (calls === 1) {
        expect(offset).toBe(1); // comeca de offset+1 do estado vazio (0)
        return updates;
      }
      await adapter.onModuleDestroy(); // pede parar na proxima leitura
      return [];
    });

    await adapter.onModuleInit();
    await adapter.stopped();

    expect(conversation.handleMessage).toHaveBeenCalledTimes(2);
    expect(prisma.telegramBotState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ lastUpdateId: 12n }) }),
    );
    expect(client.setMyCommands).toHaveBeenCalled();
  });

  it('menu de comandos inclui "Meus cartões" (cartoes)', async () => {
    const { adapter, client, prisma } = buildStack();
    client.getUpdates.mockImplementation(async () => {
      await adapter.onModuleDestroy();
      return [];
    });
    (prisma.telegramBotState.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await adapter.onModuleInit();
    await adapter.stopped();

    expect(client.setMyCommands).toHaveBeenCalledWith(
      expect.arrayContaining([{ command: 'cartoes', description: 'Meus cartões' }]),
    );
  });

  it('/cartoes do menu vira "meus cartoes" no motor', async () => {
    const { adapter, conversation } = buildStack();

    await adapter.process(inbound({ text: '/cartoes' }));

    expect(conversation.handleMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'meus cartoes' }));
  });

  it('/cartao do menu vira "cartao" e a barra some so no comando', async () => {
    const { adapter, conversation } = buildStack();

    await adapter.process(inbound({ text: ' /Cartao ' }));
    await adapter.process(inbound({ updateId: 8, messageId: 'tg-8', text: 'meus cartoes' }));

    expect(conversation.handleMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'cartao' }));
    expect(conversation.handleMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: 'meus cartoes' }));
  });

  it('/saldo, /gastos e /ajuda do menu viram a frase do motor', async () => {
    const { adapter, conversation } = buildStack();

    await adapter.process(inbound({ updateId: 11, messageId: 'tg-11', text: '/saldo' }));
    await adapter.process(inbound({ updateId: 12, messageId: 'tg-12', text: '/Gastos' }));
    await adapter.process(inbound({ updateId: 13, messageId: 'tg-13', text: '/ajuda' }));

    expect(conversation.handleMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'saldo' }));
    expect(conversation.handleMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: 'gastos' }));
    expect(conversation.handleMessage).toHaveBeenNthCalledWith(3, expect.objectContaining({ text: 'ajuda' }));
  });

  it('texto que nao e comando segue igual, mesmo com barra no meio', async () => {
    const { adapter, conversation } = buildStack();

    await adapter.process(inbound({ text: '/cartoes do nubank' }));

    expect(conversation.handleMessage).toHaveBeenCalledWith(expect.objectContaining({ text: '/cartoes do nubank' }));
  });

  it('retoma do offset gravado: o proximo getUpdates pede offset+1 do ultimo lido', async () => {
    const { adapter, client, prisma } = buildStack();
    (prisma.telegramBotState.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'poll', lastUpdateId: 42n });
    client.getUpdates.mockImplementation(async () => {
      await adapter.onModuleDestroy();
      return [];
    });

    await adapter.onModuleInit();
    await adapter.stopped();

    expect(client.getUpdates).toHaveBeenCalledWith(43, 25);
  });

  it('erro de rede nao derruba o laco: loga, espera (unref) e tenta de novo; stop encerra', async () => {
    const { adapter, client } = buildStack();
    const realSetTimeout = globalThis.setTimeout;
    let fastCalls = 0;
    client.getUpdates.mockImplementation(async () => {
      fastCalls += 1;
      if (fastCalls === 1) throw new Error('rede caiu');
      await adapter.onModuleDestroy();
      return [];
    });
    // nao esperar 5s de verdade no teste
    const sleepSpy = jest.spyOn(adapter as unknown as { sleep(ms: number): Promise<void> }, 'sleep').mockResolvedValue(undefined);

    await adapter.onModuleInit();
    await adapter.stopped();

    expect(sleepSpy).toHaveBeenCalledWith(5000);
    expect(fastCalls).toBe(2);
    sleepSpy.mockRestore();
    void realSetTimeout;
  });

  it('canal desligado nao inicia laco e nao exige o token', async () => {
    const { adapter, client } = buildStack();
    const config = { get: () => undefined } as unknown as ConfigService;
    const desligado = new (Object.getPrototypeOf(adapter).constructor)(
      {} as never, config, {} as never, {} as never, {} as never, client as never,
    ) as TelegramAdapterService;

    await desligado.onModuleInit();
    await desligado.stopped();

    expect(client.getUpdates).not.toHaveBeenCalled();
  });

  it('ligado sem token recusa (a applicacao nao sobe)', async () => {
    const { adapter } = buildStack();
    const config = { get: (key: string) => (key === 'telegram.enabled' ? true : undefined) } as unknown as ConfigService;
    const semToken = new (Object.getPrototypeOf(adapter).constructor)(
      {} as never, config, {} as never, {} as never, {} as never, {} as never,
    ) as TelegramAdapterService;

    expect(() => semToken.onModuleInit()).toThrow(/TELEGRAM_BOT_TOKEN/);
  });
});
