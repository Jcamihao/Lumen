import { TelegramController } from './telegram.controller';

function build(enabled = true) {
  const links = {
    createCode: jest.fn(async () => ({ code: 'K7M2PQ4X', expiresAt: new Date() })),
    getStatus: jest.fn(async () => ({ enabled, linked: false })),
    unlinkByUserId: jest.fn(async () => undefined),
  };
  const client = { getBotUsername: jest.fn(async () => (enabled ? 'lumen_bot' : null)) };
  const controller = new TelegramController(links as never, client as never);
  return { controller, links, client };
}

const user = { sub: 'user-a' } as never;

describe('TelegramController (rotas do vinculo, D1)', () => {
  it('link-code delega ao servico e devolve codigo e prazo', async () => {
    const { controller, links } = build();

    await expect(controller.linkCode(user)).resolves.toEqual({ code: 'K7M2PQ4X', expiresAt: expect.any(Date) });
    expect(links.createCode).toHaveBeenCalledWith('user-a');
  });

  it('status traz @ do bot junto com o estado quando o canal esta ligado', async () => {
    const { controller } = build(true);

    await expect(controller.status(user)).resolves.toEqual({
      enabled: true,
      linked: false,
      botUsername: 'lumen_bot',
    });
  });

  it('canal desligado nao pergunta o @ do bot ao Telegram', async () => {
    const { controller, client } = build(false);

    const status = await controller.status(user);

    expect(status).toEqual({ enabled: false, linked: false });
    expect(client.getBotUsername).not.toHaveBeenCalled();
  });

  it('unlink e idempotente e responde sem corpo', async () => {
    const { controller, links } = build();

    await expect(controller.unlink(user)).resolves.toBeUndefined();
    expect(links.unlinkByUserId).toHaveBeenCalledWith('user-a');
  });
});
