import { ConfigService } from '@nestjs/config';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WhatsappController } from './whatsapp.controller';

const SECRET = 'segredo-webhook-teste';
const body = { event: 'message.received', sessionId: 'lumen', data: { from: '5511999990000@s.whatsapp.net' } };
const rawBody = Buffer.from(JSON.stringify(body));
const sign = (buf: Buffer, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(buf).digest('hex')}`;

function build(options: { enabled?: boolean; secret?: string } = {}) {
  const values: Record<string, unknown> = {
    'whatsapp.enabled': options.enabled ?? true,
    'whatsapp.waAkgWebhookSecret': options.secret ?? SECRET,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  const links = {
    createCode: jest.fn(async () => ({ code: 'ABCD-EFGH', expiresAt: new Date() })),
    getStatus: jest.fn(async () => ({ enabled: true, linked: false })),
    unlinkByUserId: jest.fn(async () => undefined),
  };
  const adapter = { handleInbound: jest.fn(async () => undefined) };
  const controller = new WhatsappController(config, links as never, adapter as never);
  return { controller, links, adapter };
}

const req = (buf?: Buffer) => ({ rawBody: buf }) as never;

describe('WhatsappController.webhook', () => {
  it('sem assinatura: 401 e nada processado', () => {
    const { controller, adapter } = build();
    expect(() => controller.webhook(req(rawBody), undefined, body)).toThrow(UnauthorizedException);
    expect(adapter.handleInbound).not.toHaveBeenCalled();
  });

  it('assinatura invalida: 401 e nada processado', () => {
    const { controller, adapter } = build();
    expect(() => controller.webhook(req(rawBody), sign(rawBody, 'outro'), body)).toThrow(UnauthorizedException);
    expect(adapter.handleInbound).not.toHaveBeenCalled();
  });

  it('segredo nao configurado: 401 mesmo com assinatura, nunca processa', () => {
    const { controller, adapter } = build({ secret: '' });
    expect(() => controller.webhook(req(rawBody), sign(rawBody, ''), body)).toThrow(UnauthorizedException);
    expect(adapter.handleInbound).not.toHaveBeenCalled();
  });

  it('recurso desligado: 503 e nada processado', () => {
    const { controller, adapter } = build({ enabled: false });
    let thrown: unknown;
    try {
      controller.webhook(req(rawBody), sign(rawBody), body);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(503);
    expect(adapter.handleInbound).not.toHaveBeenCalled();
  });

  it('assinatura valida: chama o adaptador e devolve { ok: true }', () => {
    const { controller, adapter } = build();
    expect(controller.webhook(req(rawBody), sign(rawBody), body)).toEqual({ ok: true });
    expect(adapter.handleInbound).toHaveBeenCalledWith(body);
  });

  it('corpo alterado em 1 byte com a assinatura antiga: 401', () => {
    const { controller, adapter } = build();
    const changed = Buffer.from(JSON.stringify({ ...body, sessionId: 'x' }));
    expect(() => controller.webhook(req(changed), sign(rawBody), body)).toThrow(UnauthorizedException);
    expect(adapter.handleInbound).not.toHaveBeenCalled();
  });
});

describe('WhatsappController rotas de conta', () => {
  it('link-code, status e DELETE link usam so o sub do usuario autenticado', async () => {
    const { controller, links } = build();
    const user = { sub: 'USER-A', email: 'a@x.test', role: 'USER', sessionId: 's' } as never;
    await controller.linkCode(user);
    await controller.status(user);
    await controller.unlink(user);
    expect(links.createCode).toHaveBeenCalledWith('USER-A');
    expect(links.getStatus).toHaveBeenCalledWith('USER-A');
    expect(links.unlinkByUserId).toHaveBeenCalledWith('USER-A');
  });
});
