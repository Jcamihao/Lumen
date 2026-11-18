import { createHmac } from 'crypto';
import { verifyWebhookSignature } from './webhook-signature';

const SECRET = 'segredo-de-teste';
const body = Buffer.from('{"event":"message.received"}');
const sign = (buf: Buffer, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(buf).digest('hex')}`;

describe('verifyWebhookSignature', () => {
  it('aceita assinatura valida', () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('recusa corpo alterado em 1 byte', () => {
    const changed = Buffer.from(body);
    changed[0] = changed[0] ^ 1;
    expect(verifyWebhookSignature(changed, sign(body), SECRET)).toBe(false);
  });

  it('recusa assinatura feita com outro segredo', () => {
    expect(verifyWebhookSignature(body, sign(body, 'outro'), SECRET)).toBe(false);
  });

  it('nunca lanca e recusa cabecalho ausente, sem prefixo, hex curto, hex invalido e maiusculas', () => {
    const hex = sign(body).slice('sha256='.length);
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, '', SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, hex, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, `sha256=${hex.slice(0, 10)}`, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, `sha256=${'z'.repeat(64)}`, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, `sha256=${hex.toUpperCase()}`, SECRET)).toBe(false);
  });

  it('segredo vazio recusa tudo', () => {
    expect(verifyWebhookSignature(body, sign(body, ''), '')).toBe(false);
    expect(verifyWebhookSignature(body, sign(body), '')).toBe(false);
  });
});
