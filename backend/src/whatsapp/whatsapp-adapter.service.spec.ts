import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappAdapterService, WHATSAPP_TEXTS, parseInbound, sha256 } from './whatsapp-adapter.service';

const SESSION = 'lumen';
const JID_A = '5511999990000@s.whatsapp.net';
const JID_B = '5521988887777@s.whatsapp.net';

function event(dataOver: Record<string, unknown> = {}, topOver: Record<string, unknown> = {}) {
  return {
    event: 'message.received',
    sessionId: SESSION,
    timestamp: '2026-11-18T12:00:00.000Z',
    data: {
      key: { id: 'MSG-1', remoteJid: JID_A, fromMe: false },
      pushName: 'Nome',
      messageTimestamp: 1763467200,
      from: JID_A,
      isGroup: false,
      chatType: 'PERSONAL',
      type: 'text',
      content: '50 mercado',
      ...dataOver,
    },
    ...topOver,
  };
}

/** Contador em memoria com a mesma forma do CacheQueueService. available=false simula Redis fora. */
function fakeCache(available = true) {
  const counts = new Map<string, number>();
  return {
    counts,
    hitRateLimitWindow: jest.fn(async (key: string) => {
      if (!available) return null;
      const hits = (counts.get(key) ?? 0) + 1;
      counts.set(key, hits);
      return { hits, resetAfterMs: 1000 };
    }),
    getJson: jest.fn(async (key: string) => (available && counts.has(key) ? counts.get(key) : null)),
  };
}

function build(options: { cacheAvailable?: boolean; users?: Record<string, string> } = {}) {
  const users: Record<string, string> = options.users ?? { [JID_A]: 'USER-A' };
  const cache = fakeCache(options.cacheAvailable ?? true);
  const links = {
    findUserIdByJid: jest.fn(async (jid: string) => users[jid] ?? null),
    redeem: jest.fn(async (_jid: string, code: string) => code.toUpperCase().replace(/[\s-]/g, '') === 'ABCDEFGH'),
    unlinkByUserId: jest.fn(async () => undefined),
  };
  const conversation = {
    handleMessage: jest.fn(async (..._args: unknown[]) => ({ kind: 'INFO', state: 'IDLE', text: 'Saldo do mês.' })),
  };
  const client = { sendText: jest.fn(async (..._args: unknown[]) => undefined) };
  const config = { get: (key: string) => (key === 'whatsapp.waAkgSessionId' ? SESSION : undefined) } as unknown as ConfigService;
  const service = new WhatsappAdapterService(config, cache as never, links as never, conversation as never, client as never);
  return { service, cache, links, conversation, client };
}

describe('parseInbound', () => {
  it('descarta evento errado, sessao errada, fromMe, grupo, from sem @s.whatsapp.net e sem key.id', () => {
    expect(parseInbound(event({}, { event: 'message.sent' }), SESSION)).toBeNull();
    expect(parseInbound(event({}, { sessionId: 'outra' }), SESSION)).toBeNull();
    expect(parseInbound(event({ key: { id: 'X', fromMe: true } }), SESSION)).toBeNull();
    expect(parseInbound(event({ isGroup: true }), SESSION)).toBeNull();
    expect(parseInbound(event({ from: '123@g.us' }), SESSION)).toBeNull();
    expect(parseInbound(event({ key: { fromMe: false } }), SESSION)).toBeNull();
    expect(parseInbound(null, SESSION)).toBeNull();
  });
});

describe('WhatsappAdapterService', () => {
  it('descartes silenciosos: nada enviado, motor nao chamado', async () => {
    const { service, conversation, client, links } = build();
    await service.handleInbound(event({}, { sessionId: 'outra' }));
    await service.handleInbound(event({ key: { id: 'X', fromMe: true } }));
    await service.handleInbound(event({ isGroup: true }));
    await service.handleInbound(event({ from: '123@g.us' }));
    await service.handleInbound(event({ key: { fromMe: false } }));
    expect(conversation.handleMessage).not.toHaveBeenCalled();
    expect(client.sendText).not.toHaveBeenCalled();
    expect(links.findUserIdByJid).not.toHaveBeenCalled();
  });

  it('identidade: userId falso no corpo e em data e ignorado; motor recebe o userId do vinculo', async () => {
    const { service, conversation } = build();
    await service.handleInbound(event({ userId: 'ATACANTE', accountId: 'ATACANTE', user: { sub: 'ATACANTE' } }, { userId: 'ATACANTE' }));
    expect(conversation.handleMessage).toHaveBeenCalledTimes(1);
    expect(conversation.handleMessage.mock.calls[0][0]).toMatchObject({ userId: 'USER-A' });
  });

  it('numero sem vinculo nunca chama o motor', async () => {
    const { service, conversation } = build({ users: {} });
    await service.handleInbound(event({ content: '50 mercado' }));
    expect(conversation.handleMessage).not.toHaveBeenCalled();
  });

  it('o motor recebe channel WHATSAPP, messageId igual a key.id e text igual a content', async () => {
    const { service, conversation } = build();
    await service.handleInbound(event({ key: { id: 'WA-ID-42', fromMe: false }, content: '50 mercado' }));
    expect(conversation.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'WHATSAPP', messageId: 'WA-ID-42', text: '50 mercado', userId: 'USER-A' }),
    );
  });

  it('idempotencia: a segunda entrega (kind DUPLICATE) nao e reenviada', async () => {
    const { service, conversation, client } = build();
    conversation.handleMessage
      .mockResolvedValueOnce({ kind: 'INFO', state: 'IDLE', text: 'Saldo do mês.' } as never)
      .mockResolvedValueOnce({ kind: 'DUPLICATE', state: 'IDLE', text: 'Já processei essa mensagem.' } as never);
    await service.handleInbound(event({ key: { id: 'MSG-9', fromMe: false } }));
    await service.handleInbound(event({ key: { id: 'MSG-9', fromMe: false } }));
    expect(conversation.handleMessage).toHaveBeenCalledTimes(2);
    expect(client.sendText).toHaveBeenCalledTimes(1);
    expect(client.sendText).toHaveBeenCalledWith(JID_A, 'Saldo do mês.');
  });

  it('taxa: a 21a mensagem no minuto e descartada sem responder', async () => {
    const { service, conversation, client } = build();
    for (let i = 1; i <= 21; i += 1) {
      await service.handleInbound(event({ key: { id: `M${i}`, fromMe: false } }));
    }
    expect(conversation.handleMessage).toHaveBeenCalledTimes(20);
    expect(client.sendText).toHaveBeenCalledTimes(20);
  });

  it('taxa: a 6a falha de codigo em 10 minutos e descartada sem responder', async () => {
    const { service, client, links } = build({ users: {} });
    for (let i = 1; i <= 6; i += 1) {
      await service.handleInbound(event({ key: { id: `C${i}`, fromMe: false }, content: 'ZZZZ-ZZZZ' }));
    }
    expect(links.redeem).toHaveBeenCalledTimes(5); // a 6a nem chega ao resgate
    expect(client.sendText).toHaveBeenCalledTimes(5);
  });

  it('tentativas de codigo em paralelo tambem param na 5a (contagem atomica antes do resgate)', async () => {
    const { service, links } = build({ users: {} });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.handleInbound(event({ key: { id: `P${i}`, fromMe: false }, content: 'ZZZZ-ZZZZ' })),
      ),
    );
    expect(links.redeem).toHaveBeenCalledTimes(5);
  });

  it('Redis indisponivel: numero sem vinculo e descartado; vinculado segue', async () => {
    const unlinked = build({ cacheAvailable: false, users: {} });
    await unlinked.service.handleInbound(event({ content: 'ABCD-EFGH' }));
    expect(unlinked.links.redeem).not.toHaveBeenCalled();
    expect(unlinked.client.sendText).not.toHaveBeenCalled();

    const linked = build({ cacheAvailable: false });
    await linked.service.handleInbound(event({ content: 'saldo' }));
    expect(linked.conversation.handleMessage).toHaveBeenCalledTimes(1);
  });

  it('codigo certo vincula e responde a frase de sucesso', async () => {
    const { service, client } = build({ users: {} });
    await service.handleInbound(event({ content: 'abcd efgh' }));
    expect(client.sendText).toHaveBeenCalledWith(JID_A, WHATSAPP_TEXTS.linked);
  });

  it('codigo errado responde a mesma frase generica', async () => {
    const { service, client } = build({ users: {} });
    await service.handleInbound(event({ content: 'ZZZZ-ZZZZ' }));
    expect(client.sendText).toHaveBeenCalledWith(JID_A, WHATSAPP_TEXTS.linkFailed);
  });

  it('orientacao a numero desconhecido: no maximo uma por hora por numero', async () => {
    const { service, client } = build({ users: {} });
    await service.handleInbound(event({ content: 'oi' }));
    await service.handleInbound(event({ content: 'oi de novo' }));
    expect(client.sendText.mock.calls.filter(([, text]) => text === WHATSAPP_TEXTS.hint)).toHaveLength(1);
  });

  it('midia de numero vinculado: resposta fixa e motor nao chamado', async () => {
    const { service, conversation, client } = build();
    await service.handleInbound(event({ type: 'image', content: '' }));
    expect(conversation.handleMessage).not.toHaveBeenCalled();
    expect(client.sendText).toHaveBeenCalledWith(JID_A, WHATSAPP_TEXTS.media);
  });

  it('"desvincular whatsapp" desvincula e confirma', async () => {
    const { service, links, client, conversation } = build();
    await service.handleInbound(event({ content: '  Desvincular   WhatsApp ' }));
    expect(links.unlinkByUserId).toHaveBeenCalledWith('USER-A');
    expect(client.sendText).toHaveBeenCalledWith(JID_A, WHATSAPP_TEXTS.unlinked);
    expect(conversation.handleMessage).not.toHaveBeenCalled();
  });

  it('texto vazio e de 1001 caracteres: motor nao chamado', async () => {
    const { service, conversation } = build();
    await service.handleInbound(event({ content: '   ' }));
    await service.handleInbound(event({ content: 'x'.repeat(1001) }));
    expect(conversation.handleMessage).not.toHaveBeenCalled();
  });

  it('falha do cliente de envio nao lanca', async () => {
    const { service, client } = build();
    client.sendText.mockRejectedValueOnce(new Error('WA-AKG envio falhou: http 503'));
    await expect(service.handleInbound(event({ content: 'saldo' }))).resolves.toBeUndefined();
  });

  it('log de falha de envio usa so o numero mascarado: sem jid inteiro, sem texto da mensagem', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { service, client } = build();
      client.sendText.mockRejectedValueOnce(new Error('WA-AKG envio falhou: http 503'));
      await service.handleInbound(event({ content: 'gastei 77 com segredo-xyz' }));
      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('+55 11 *****-0000');
      expect(logged).not.toContain('5511999990000');
      expect(logged).not.toContain('segredo-xyz');
    } finally {
      warn.mockRestore();
    }
  });

  it('o hash do jid e sha256 (chave de taxa nao mostra o numero)', () => {
    expect(sha256(JID_B)).toHaveLength(64);
    expect(sha256(JID_B)).not.toContain('5521');
  });
});
