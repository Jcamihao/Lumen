#!/usr/bin/env node
/**
 * WA-AKG falso para provar o adaptador de WhatsApp do Lumen (item 5a, 5c). NAO e o WA-AKG real.
 *
 * Uso:
 *   FAKE_PORT=3392 FAKE_API_KEY=chave-de-teste node fake-wa-akg.mjs
 *   (depois aponte WA_AKG_BASE_URL=http://127.0.0.1:3392 e WA_AKG_API_KEY=chave-de-teste no backend)
 *
 * O que ele faz:
 *   1. Recebe POST /api/messages/{sessionId}/{jid}/send, confere X-API-Key e guarda o que chegou.
 *      Modo de resposta (POST /_fake/mode {"mode":"ok"|"500"|"hang"|"redirect"}): ok = 200, 500 = erro, hang = nao responde,
 *      redirect = 307 para http://127.0.0.1:FAKE_PORT/_fake/redirect-target (para provar que a chave nao e reenviada).
 *   2. Assina e envia webhooks ao Lumen, como o WA-AKG real (X-Webhook-Signature: sha256=<hmac hex do corpo bruto>):
 *      POST /_fake/deliver
 *        { "target": "http://127.0.0.1:3391/api/v1/whatsapp/webhook",
 *          "secret": "segredo-do-webhook",
 *          "payload": {...}        // enviado como JSON.stringify(payload); ou
 *          "rawBody": "<texto>",   // bytes exatos (espacos, ordem de chaves) em vez de payload
 *          "sign": "valid" | "none" | "invalid"   // padrao valid
 *          "tamperByte": true      // assina o corpo original e envia com 1 byte trocado
 *          "signBody": "<texto>"   // assina este texto em vez do enviado (assinatura sobre outros bytes)
 *        }
 *      Resposta: { status, body } do Lumen.
 *   3. Apoio: GET /_fake/sent (lista), POST /_fake/reset (limpa lista e modo), GET /_fake/key-seen-on-redirect.
 *
 * Nenhum segredo e gravado em disco nem logado: o servidor so escreve a linha de boot.
 */
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

const PORT = Number(process.env.FAKE_PORT ?? 3392);
const API_KEY = process.env.FAKE_API_KEY ?? '';
let sent = [];
let mode = 'ok';
let redirectTargetHits = [];

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const body = await readBody(req);

  const send = url.pathname.match(/^\/api\/messages\/([^/]+)\/([^/]+)\/send$/);
  if (req.method === 'POST' && send) {
    if (req.headers['x-api-key'] !== API_KEY) return json(res, 401, { status: false, message: 'unauthorized' });
    if (mode === 'hang') return; // nao responde: o cliente do Lumen precisa estourar o timeout
    if (mode === '500') return json(res, 500, { status: false, message: 'erro simulado' });
    if (mode === 'redirect') {
      res.writeHead(307, { Location: `http://127.0.0.1:${PORT}/_fake/redirect-target` });
      return res.end();
    }
    let text = null;
    try {
      text = JSON.parse(body.toString('utf8'))?.message?.text ?? null;
    } catch {
      /* corpo invalido: guarda null */
    }
    sent.push({
      sessionId: decodeURIComponent(send[1]),
      jid: decodeURIComponent(send[2]),
      text,
      contentType: req.headers['content-type'],
      at: new Date().toISOString(),
    });
    return json(res, 200, { status: true, message: 'ok', data: {} });
  }

  if (url.pathname === '/_fake/redirect-target') {
    redirectTargetHits.push({ hasApiKey: Boolean(req.headers['x-api-key']) });
    return json(res, 200, { status: true });
  }
  if (req.method === 'GET' && url.pathname === '/_fake/key-seen-on-redirect') return json(res, 200, redirectTargetHits);
  if (req.method === 'GET' && url.pathname === '/_fake/sent') return json(res, 200, sent);
  if (req.method === 'POST' && url.pathname === '/_fake/reset') {
    sent = [];
    mode = 'ok';
    redirectTargetHits = [];
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/_fake/mode') {
    mode = JSON.parse(body.toString('utf8')).mode;
    return json(res, 200, { mode });
  }
  if (req.method === 'POST' && url.pathname === '/_fake/deliver') {
    const spec = JSON.parse(body.toString('utf8'));
    const original = Buffer.from(spec.rawBody ?? JSON.stringify(spec.payload), 'utf8');
    const headers = { 'Content-Type': 'application/json' };
    // signBody: assina outro texto que nao o enviado (prova que a assinatura vale sobre os bytes enviados).
    const signed = spec.signBody !== undefined ? Buffer.from(spec.signBody, 'utf8') : original;
    const hex = createHmac('sha256', spec.secret ?? '').update(signed).digest('hex');
    const mode_ = spec.sign ?? 'valid';
    if (mode_ === 'valid') headers['X-Webhook-Signature'] = `sha256=${hex}`;
    if (mode_ === 'invalid') headers['X-Webhook-Signature'] = `sha256=${'0'.repeat(64)}`;
    let toSend = original;
    if (spec.tamperByte) {
      toSend = Buffer.from(original);
      const i = toSend.indexOf(0x35); // troca o primeiro '5' por '6'
      toSend[i >= 0 ? i : 0] = toSend[i >= 0 ? i : 0] === 0x36 ? 0x37 : 0x36;
    }
    try {
      const response = await fetch(spec.target, { method: 'POST', headers, body: toSend });
      const text = await response.text();
      return json(res, 200, { status: response.status, body: text });
    } catch (error) {
      return json(res, 200, { status: 0, body: String(error?.message ?? error) });
    }
  }
  json(res, 404, { status: false });
});

server.listen(PORT, '127.0.0.1', () => console.log(`fake-wa-akg ouvindo em 127.0.0.1:${PORT}`));
