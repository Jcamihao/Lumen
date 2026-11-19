import { timingSafeEqual, createHmac } from 'crypto';

const SIGNATURE_PREFIX = 'sha256=';
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/**
 * Confere `X-Webhook-Signature: sha256=<hex>` contra HMAC-SHA256(segredo, corpo bruto).
 * Nunca lanca: qualquer entrada invalida vira false. Aceita so hex minusculo.
 */
export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !rawBody || typeof header !== 'string') {
    return false;
  }
  if (!header.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }
  const received = header.slice(SIGNATURE_PREFIX.length);
  if (!HEX_SHA256.test(received)) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const receivedBuf = Buffer.from(received, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (receivedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(receivedBuf, expectedBuf);
}
