import { TelegramBotClient, TelegramBotError, parseTelegramUpdate } from './telegram-bot.client';

const config = { get: jest.fn((key: string) => ({
  'telegram.baseUrl': 'https://api.telegram.org',
  'telegram.botToken': 'TOKEN-SECRETO',
  'telegram.timeoutMs': 8000,
} as Record<string, unknown>)[key]) };

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('TelegramBotClient (Bot API crua, D8)', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('sendMessage chama /bot<token>/sendMessage com HTML e sem teclado por padrao', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: {} }));
    const client = new TelegramBotClient(config as never);

    await client.sendMessage('123456789', 'Ola & adeus');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botTOKEN-SECRETO/sendMessage');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(JSON.parse(init.body)).toEqual({ chat_id: '123456789', text: 'Ola & adeus', parse_mode: 'HTML' });
  });

  it('teclado so vai no ultimo envio e uma linha por botao (D4)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: {} }));
    const client = new TelegramBotClient(config as never);

    await client.sendMessage('1', 'parte', ['limpar', 'cancelar']);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reply_markup).toEqual({
      keyboard: [[{ text: 'limpar' }], [{ text: 'cancelar' }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    await client.sendMessage('1', 'parte sem teclado');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reply_markup).toBeUndefined();
  });

  it('getUpdates e GET com offset/timeout/allowed_updates e timeout da request acima do do Telegram', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: [{ update_id: 7 }] }));
    const client = new TelegramBotClient(config as never);

    const updates = await client.getUpdates(42, 25);

    expect(updates).toEqual([{ update_id: 7 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(url).toContain('/botTOKEN-SECRETO/getUpdates?');
    expect(url).toContain('offset=42');
    expect(url).toContain('timeout=25');
    expect(url).toContain('allowed_updates=%5B%22message%22%5D');
    expect(init.signal).toBeDefined();
  });

  it('getUpdates sem resultado lista nao explode', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const client = new TelegramBotClient(config as never);
    await expect(client.getUpdates(1, 0)).resolves.toEqual([]);
  });

  it('ok:false com HTTP 200 e erro (nao sucesso vazio), e o motivo nao vaza o corpo', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, description: 'token segredo echo' }, 200));
    const client = new TelegramBotClient(config as never);

    const error = await client.sendMessage('1', 'oi').catch((e) => e);
    expect(error).toBeInstanceOf(TelegramBotError);
    expect(error.message).not.toContain('echo');
  });

  it('falha de rede vira network sem URL nem token na mensagem', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('boom https://api.telegram.org/botTOKEN-SECRETO/x'), { name: 'TypeError' }));
    const client = new TelegramBotClient(config as never);

    const error = await client.sendMessage('1', 'oi').catch((e) => e);
    expect(error).toBeInstanceOf(TelegramBotError);
    expect(error.reason).toBe('network');
    expect(error.message).not.toContain('TOKEN');
  });

  it('getBotUsername memoiza e falha nao memoiza', async () => {
    const client = new TelegramBotClient(config as never);
    fetchMock.mockRejectedValueOnce(new Error('red down'));
    await expect(client.getBotUsername()).resolves.toBeNull();

    fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: { username: 'lumen_bot' } }));
    await expect(client.getBotUsername()).resolves.toBe('lumen_bot');
    await client.getBotUsername();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('parseTelegramUpdate (descarte silencioso)', () => {
  const base = { update_id: 5, message: { message_id: 9, chat: { id: 111, type: 'private' }, text: 'oi' } };

  it('aceita mensagem de chat privado', () => {
    expect(parseTelegramUpdate(base)).toEqual({ updateId: 5, chatId: '111', messageId: 'tg-5', text: 'oi', hasText: true });
  });

  it('descarta grupo, canal, edicao, callback, forma quebrada e ids impossiveis', () => {
    expect(parseTelegramUpdate({ ...base, message: { ...base.message, chat: { id: 1, type: 'group' } } })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 5, edited_message: base.message })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 5, callback_query: { data: 'confirmar' } })).toBeNull();
    expect(parseTelegramUpdate(null)).toBeNull();
    expect(parseTelegramUpdate('x')).toBeNull();
    expect(parseTelegramUpdate({ ...base, update_id: 1.5 })).toBeNull();
    expect(parseTelegramUpdate({ ...base, message: { ...base.message, chat: { id: -5, type: 'private' } } })).toBeNull();
  });

  it('midia sem texto e entrada sem texto (a resposta e do adapter)', () => {
    const photo = { update_id: 6, message: { message_id: 10, chat: { id: 111, type: 'private' }, photo: [{ file_id: 'x' }] } };
    expect(parseTelegramUpdate(photo)).toEqual({ updateId: 6, chatId: '111', messageId: 'tg-6', text: '', hasText: false });
  });
});
