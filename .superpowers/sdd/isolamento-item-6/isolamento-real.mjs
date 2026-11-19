#!/usr/bin/env node
/**
 * Roteiro de isolamento A/B/C contra o backend REAL (Postgres e Redis de verdade) e o WA-AKG falso.
 * Item 6 do assistente de Finanças. NAO tem segredo embutido: tudo vem de variaveis de ambiente.
 *
 * Preparacao (o que este script NAO faz):
 *   1. Postgres 16 e Redis 7 descartaveis, `prisma migrate deploy` aplicado.
 *   2. Backend `node dist/main` com WHATSAPP_ENABLED=true, WA_AKG_BASE_URL apontando para o falso,
 *      e WHATSAPP_WRITES_ENABLED igual ao valor de WRITES abaixo. Anote o log do backend em BACKEND_LOG.
 *   3. WA-AKG falso: `FAKE_PORT=<porta> FAKE_API_KEY=<chave> node .superpowers/sdd/whatsapp-item-5/fake-wa-akg.mjs`.
 *
 * Variaveis (todas obrigatorias, salvo as com padrao):
 *   BASE            URL do backend com prefixo, ex.: http://127.0.0.1:3661/api/v1
 *   FAKE            URL do falso, ex.: http://127.0.0.1:3662
 *   WEBHOOK_SECRET  o mesmo WA_AKG_WEBHOOK_SECRET do backend
 *   WA_SESSION_ID   o mesmo WA_AKG_SESSION_ID do backend
 *   BACKEND_DIR     pasta backend do repositorio (para achar @prisma/client e ioredis)
 *   DATABASE_URL    banco descartavel
 *   REDIS_URL       redis descartavel (limpa as chaves de limite de taxa entre as etapas)
 *   TEST_PASSWORD   senha forte das contas de teste
 *   WRITES          "true" ou "false": como o backend foi iniciado (WHATSAPP_WRITES_ENABLED)
 *   PHASE           "writes-true" (cenarios 1 a 5, com WRITES=true), "writes-false" (cenario 7, com WRITES=false)
 *   BACKEND_LOG, FAKE_LOG   (opcional) arquivos de log para o cenario 6 (grep)
 *   GREP_SECRETS    (opcional) segredos extras a procurar nos logs, separados por virgula (nunca impressos)
 *
 * Saida: uma linha PASS/FAIL por verificacao, resumo e codigo de saida 1 se algo falhar.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`falta a variavel ${name}`);
  return value;
};
const BASE = need('BASE');
const FAKE = need('FAKE');
const WEBHOOK_SECRET = need('WEBHOOK_SECRET');
const WA_SESSION_ID = need('WA_SESSION_ID');
const BACKEND_DIR = need('BACKEND_DIR');
const PASSWORD = need('TEST_PASSWORD');
const WRITES = need('WRITES') === 'true';
const PHASE = need('PHASE');
need('DATABASE_URL');
const REDIS_URL = need('REDIS_URL');
const RUN = randomUUID().slice(0, 8);

const requireFromBackend = createRequire(path.join(BACKEND_DIR, 'package.json'));
const { PrismaClient } = requireFromBackend('@prisma/client');
const Redis = requireFromBackend('ioredis');
const db = new PrismaClient();
const redis = new Redis(REDIS_URL);

// ---------- relatorio ----------
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
}
/** Mesma resposta: mesmo status e mesmo corpo, ignorando so campos volateis por requisicao (requestId, timestamp). */
function sameResponse(a, b) {
  const strip = (r) => {
    try {
      const j = JSON.parse(r.text);
      delete j.requestId;
      delete j.timestamp;
      return JSON.stringify(j);
    } catch {
      return r.text;
    }
  };
  return a.status === b.status && strip(a) === strip(b);
}
const note = (text) => console.log(`NOTA  ${text}`);
const section = (title) => console.log(`\n=== ${title}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- HTTP ----------
async function api(method, route, { token, body, raw } = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* corpo nao JSON */
  }
  return { status: response.status, text, json };
}

async function deliver(from, text, { id = `${RUN}-${randomUUID()}`, data = {}, top = {}, type = 'text', sign = 'valid' } = {}) {
  const payload = {
    event: 'message.received',
    sessionId: WA_SESSION_ID,
    timestamp: new Date().toISOString(),
    data: { key: { id, remoteJid: from, fromMe: false }, pushName: 'Nome', from, isGroup: false, chatType: 'PERSONAL', type, content: text, ...data },
    ...top,
  };
  const response = await fetch(`${FAKE}/_fake/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: `${BASE}/whatsapp/webhook`, secret: WEBHOOK_SECRET, payload, sign }),
  });
  return response.json();
}

const sentAll = async () => (await fetch(`${FAKE}/_fake/sent`)).json();
const sentTo = async (jid) => (await sentAll()).filter((item) => item.jid === jid);

/** O backend responde 200 e processa depois: espera o falso e o banco ficarem quietos. */
async function settle(maxMs = 8000) {
  const started = Date.now();
  let last = '';
  let stableSince = Date.now();
  while (Date.now() - started < maxMs) {
    const snapshot = `${(await sentAll()).length}|${await db.conversationEvent.count()}|${await db.conversationSession.count()}|${await db.transaction.count()}`;
    if (snapshot !== last) {
      last = snapshot;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > 500) {
      return;
    }
    await sleep(100);
  }
}

const flushRate = async () => {
  for (const pattern of ['whatsapp:rate:*', 'whatsapp:hint:*', 'whatsapp:linkfail:*', 'auth-*', 'whatsapp-link*', '*rate-limit*', '*ratelimit*']) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
};

// ---------- contas ----------
const WHO = ['A', 'B', 'C'];
const JID = { A: '5511911110001@s.whatsapp.net', B: '5521922220002@s.whatsapp.net', C: '5531933330003@s.whatsapp.net', D: '5541944440004@s.whatsapp.net' };
/** Numero atual de cada conta (muda no cenario 5, quando A e B trocam de numero). */
const cur = { ...JID };
/** Ids de linhas de outras contas usados nos ataques: nunca podem aparecer em log. */
const watchIds = new Set();
const TAG = { A: 'Zeta', B: 'Beta', C: 'Gama' };
// A nota importada de cada conta (10, 11 e 12) tambem sai do saldo.
const brl = (value) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const MONEY = { A: { income: 10000, expense: 8765.44, ceiling: 2000 }, B: { income: 9000, expense: 1222.23, ceiling: 5000 }, C: { income: 5000, expense: 757.58, ceiling: 900 } };
for (const [index, who] of ['A', 'B', 'C'].entries()) MONEY[who].balance = brl(MONEY[who].income - MONEY[who].expense - (10 + index));
const acc = {}; // acc.A = { token, userId, email }
const cat = (who) => `Mercado ${TAG[who]}`;
const goalName = (who) => `Viagem ${TAG[who]}`;
const secrets = (who) => [MONEY[who].balance, cat(who).toLowerCase(), goalName(who).toLowerCase(), acc[who].userId, JID[who].split('@')[0]];
const foreignSecrets = (who) => WHO.filter((w) => w !== who).flatMap(secrets);

async function mustOk(label, promise) {
  const result = await promise;
  if (result.status >= 300) throw new Error(`${label}: HTTP ${result.status} ${result.text.slice(0, 200)}`);
  return result;
}

async function setupAccounts() {
  for (const who of WHO) {
    const email = `iso-${RUN}-${who.toLowerCase()}@example.test`;
    const registered = await mustOk(`registro ${who}`, api('POST', '/auth/register', { body: { name: `Conta ${who}`, email, password: PASSWORD, privacyNoticeAccepted: true, timezone: 'America/Sao_Paulo' } }));
    const token = registered.json.accessToken;
    const userId = registered.json.user.id;
    acc[who] = { token, userId, email };
    const t = { token };
    const expenseCat = await mustOk('categoria despesa', api('POST', '/finance-categories', { ...t, body: { name: cat(who), color: '#112233', type: 'EXPENSE' } }));
    const incomeCat = await mustOk('categoria receita', api('POST', '/finance-categories', { ...t, body: { name: `Salario ${TAG[who]}`, color: '#223344', type: 'INCOME' } }));
    const now = new Date().toISOString();
    await mustOk('receita', api('POST', '/transactions', { ...t, body: { type: 'INCOME', description: `Salario ${TAG[who]}`, amount: MONEY[who].income, date: now, categoryId: incomeCat.json.id } }));
    await mustOk('despesa', api('POST', '/transactions', { ...t, body: { type: 'EXPENSE', description: `Compra base ${TAG[who]}`, amount: MONEY[who].expense, date: now, categoryId: expenseCat.json.id, paymentMethod: 'CREDIT' } }));
    await mustOk('meta', api('POST', '/goals', { ...t, body: { title: goalName(who), targetAmount: 3000, currentAmount: 1000 } }));
    await mustOk('limite', api('PUT', '/credit-cycle/ceiling', { ...t, body: { ceiling: MONEY[who].ceiling } }));
    // Nota importada: o ReceiptScan entra direto no banco (a leitura por QR/OCR nao e o assunto aqui) e a confirmacao usa a rota real.
    const scan = await db.receiptScan.create({
      data: { userId, fileName: `nota-${TAG[who]}.pdf`, mimeType: 'application/pdf', merchantName: `Loja ${TAG[who]}`, totalAmount: 10 + WHO.indexOf(who), purchaseDate: new Date(), confidence: 'high', items: { create: [{ description: `Item ${TAG[who]}`, quantity: 1, unitPrice: 10, totalPrice: 10, sortOrder: 0 }] } },
    });
    await mustOk('nota importada', api('POST', '/imports/receipts/commit', { ...t, body: { receiptScanId: scan.id, categoryId: expenseCat.json.id } }));
    acc[who].scanId = scan.id;
  }
}

async function linkAll() {
  for (const who of WHO) {
    const code = (await mustOk('codigo', api('POST', '/whatsapp/link-code', { token: acc[who].token }))).json.code;
    acc[who].lastCode = code;
    await deliver(JID[who], code.toLowerCase());
  }
  await settle();
}

/** Saldo atual da conta pela mesma conta que o app mostra (receitas - despesas), em texto pt-BR. */
async function balanceOf(who) {
  const rows = await db.transaction.groupBy({ by: ['type'], where: { userId: acc[who].userId }, _sum: { amount: true } });
  const sum = (type) => Number(rows.find((row) => row.type === type)?._sum.amount ?? 0);
  return brl(sum('INCOME') - sum('EXPENSE'));
}
const txCount = (who, where = {}) => db.transaction.count({ where: { userId: acc[who].userId, ...where } });
const waSession = (who) => db.conversationSession.findFirst({ where: { userId: acc[who].userId, channel: 'WHATSAPP' } });
const appSession = (who) => db.conversationSession.findFirst({ where: { userId: acc[who].userId, channel: 'APP' } });
const appMsg = (who, text, messageId = randomUUID()) => api('POST', '/conversation/message', { token: acc[who].token, body: { messageId, text } });

async function domainCounts(who) {
  const userId = acc[who].userId;
  return {
    tx: await db.transaction.count({ where: { userId } }),
    goals: await db.goal.count({ where: { userId } }),
    goalSum: String((await db.goal.aggregate({ where: { userId }, _sum: { currentAmount: true } }))._sum.currentAmount),
    envelopes: await db.envelope.count({ where: { userId } }),
    recurring: await db.recurringTransaction.count({ where: { userId } }),
    installments: await db.installmentPurchase.count({ where: { userId } }),
    ceilings: JSON.stringify(await db.creditCycleCeiling.findMany({ where: { userId }, select: { ceiling: true } })),
  };
}

// ---------- cenarios ----------
async function s1() {
  section('1. contas A/B/C, dados proprios, vinculo por codigo (webhook assinado)');
  await setupAccounts();
  await linkAll();
  for (const who of WHO) {
    const link = await db.whatsappLink.findUnique({ where: { userId: acc[who].userId } });
    check(`vinculo de ${who} no JID de ${who}`, link?.jid === JID[who]);
    const status = await api('GET', '/whatsapp/status', { token: acc[who].token });
    check(`status de ${who} vinculado e mascarado`, status.json?.linked === true && !status.text.includes(JID[who].split('@')[0]), status.text);
  }
  const codes = await db.whatsappLinkCode.findMany();
  check('codigos so em hash no banco', codes.every((row) => /^[0-9a-f]{64}$/.test(row.codeHash)));
  for (const who of WHO) {
    const imported = await db.receiptScan.findUnique({ where: { id: acc[who].scanId } });
    check(`nota importada de ${who} ficou na conta ${who}`, imported.status === 'IMPORTED' && imported.userId === acc[who].userId);
  }
  // A tenta importar a nota de B pela rota real: nao encontrada, igual a nota inexistente.
  const foreign = await api('POST', '/imports/receipts/commit', { token: acc.A.token, body: { receiptScanId: acc.B.scanId } });
  const missing = await api('POST', '/imports/receipts/commit', { token: acc.A.token, body: { receiptScanId: randomUUID() } });
  check('importar nota de outra conta: 404 igual a nota inexistente', foreign.status === 404 && sameResponse(foreign, missing), `${foreign.status} ${foreign.text} | ${missing.status} ${missing.text}`);
  for (const who of WHO) {
    const reply = await appMsg(who, 'importar nota');
    check(`"importar nota" de ${who}: so orienta, sem dado de outra conta`, reply.json?.data?.screen === 'imports' && !foreignSecrets(who).some((s) => reply.text.toLowerCase().includes(s)), reply.text);
  }
}

async function s2() {
  section('2. WRITES=true: ler, confirmar, cancelar e reabrir por id de outra conta (app e WhatsApp)');
  await flushRate();
  // rascunhos: B no app e no WhatsApp, A no app e no WhatsApp
  const draftApp = {};
  for (const who of ['A', 'B']) {
    const reply = await appMsg(who, `50 ${cat(who).toLowerCase()}`);
    draftApp[who] = reply.json?.draft;
    check(`rascunho APP de ${who} montado`, reply.json?.kind === 'CONFIRM_DRAFT', reply.text);
  }
  for (const who of ['A', 'B']) await deliver(JID[who], `51 ${cat(who).toLowerCase()}`);
  await settle();
  const wa = { A: await waSession('A'), B: await waSession('B') };
  check('rascunho WHATSAPP de A e B montados', wa.A?.state === 'AWAITING_CONFIRMATION' && wa.B?.state === 'AWAITING_CONFIRMATION');
  for (const id of [draftApp.B.draftId, wa.B.id, draftApp.A.draftId, wa.A.id, acc.B.scanId, acc.A.scanId, acc.C.scanId]) watchIds.add(id);
  const before = { A: await domainCounts('A'), B: await domainCounts('B'), C: await domainCounts('C') };
  const versionsB = { app: (await appSession('B')).version, wa: wa.B.version };

  const targets = [
    ['APP de B', draftApp.B.draftId, draftApp.B.draftVersion],
    ['WHATSAPP de B', wa.B.id, wa.B.version],
  ];
  const ghost = randomUUID();
  for (const [label, id, version] of targets) {
    const foreignConfirm = await api('POST', '/conversation/confirm', { token: acc.A.token, body: { draftId: id, draftVersion: version } });
    const missingConfirm = await api('POST', '/conversation/confirm', { token: acc.A.token, body: { draftId: ghost, draftVersion: version } });
    note(`${label}: confirmar alheio -> ${foreignConfirm.status} ${foreignConfirm.text.slice(0, 160)} | confirmar inexistente -> ${missingConfirm.status} ${missingConfirm.text.slice(0, 160)}`);
    check(`confirmar rascunho ${label} com token de A: 404 identico ao id inexistente`, foreignConfirm.status === 404 && sameResponse(foreignConfirm, missingConfirm), `${foreignConfirm.status} ${foreignConfirm.text} | ${missingConfirm.status} ${missingConfirm.text}`);
    const foreignCancel = await api('POST', '/conversation/cancel', { token: acc.A.token, body: { draftId: id } });
    const missingCancel = await api('POST', '/conversation/cancel', { token: acc.A.token, body: { draftId: ghost } });
    check(`cancelar rascunho ${label} com token de A: 404 identico ao id inexistente`, foreignCancel.status === 404 && sameResponse(foreignCancel, missingCancel), `${foreignCancel.status} ${foreignCancel.text} | ${missingCancel.status} ${missingCancel.text}`);
    // draftVersion de B com o draftId de A (e o inverso)
    const crossA = await api('POST', '/conversation/confirm', { token: acc.A.token, body: { draftId: draftApp.A.draftId, draftVersion: 999 } });
    check('confirmar o proprio rascunho com versao errada: 404, sem gravar', crossA.status === 404);
  }
  const sessionA = await api('GET', '/conversation/session', { token: acc.A.token });
  check('reabrir (GET /session) de A nao traz o rascunho de B', sessionA.status === 200 && !sessionA.text.includes(draftApp.B.draftId) && !sessionA.text.includes(wa.B.id) && !foreignSecrets('A').some((s) => sessionA.text.toLowerCase().includes(s)), sessionA.text);
  const sessionC = await api('GET', '/conversation/session', { token: acc.C.token });
  check('reabrir de C (sem rascunho): IDLE', sessionC.json?.state === 'IDLE', sessionC.text);

  // userId falso no corpo e no cabecalho
  const withUserId = await api('POST', '/conversation/message', { token: acc.A.token, body: { messageId: randomUUID(), text: 'saldo', userId: acc.B.userId } });
  check('userId no corpo de /conversation/message: recusado (400)', withUserId.status === 400, `${withUserId.status} ${withUserId.text}`);
  const withUserIdConfirm = await api('POST', '/conversation/confirm', { token: acc.A.token, body: { draftId: wa.B.id, draftVersion: wa.B.version, userId: acc.B.userId } });
  check('userId no corpo de /confirm: recusado (400)', withUserIdConfirm.status === 400, `${withUserIdConfirm.status}`);
  const withUserIdCancel = await api('POST', '/conversation/cancel', { token: acc.A.token, body: { draftId: wa.B.id, userId: acc.B.userId } });
  check('userId no corpo de /cancel: recusado (400)', withUserIdCancel.status === 400, `${withUserIdCancel.status}`);
  const header = await fetch(`${BASE}/conversation/message`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${acc.A.token}`, 'X-User-Id': acc.B.userId, 'X-Account-Id': acc.B.userId }, body: JSON.stringify({ messageId: randomUUID(), text: 'saldo' }) });
  const headerJson = await header.json();
  check('cabecalho X-User-Id de B ignorado: resposta e o saldo de A', header.status === 200 && JSON.stringify(headerJson).includes(await balanceOf('A')) && !JSON.stringify(headerJson).includes(await balanceOf('B')), JSON.stringify(headerJson));

  // webhook com userId/accountId/participant extras: o dono e o do `from`
  await deliver(JID.A, 'saldo', { id: `${RUN}-hostil-1`, data: { userId: acc.B.userId, accountId: acc.B.userId, user: { id: acc.B.userId }, participant: JID.B, key: { id: `${RUN}-hostil-1`, remoteJid: JID.B, fromMe: false, participant: JID.B } }, top: { userId: acc.B.userId, accountId: acc.B.userId } });
  await settle();
  const hostileA = await sentTo(JID.A);
  const hostileB = await sentTo(JID.B);
  check('payload hostil (userId/accountId/participant de B) vindo do numero de A: resposta so para A', hostileA.some((m) => m.text?.includes('Saldo')) && !JSON.stringify(hostileA).includes(await balanceOf('B')));
  check('o numero de B nao recebeu nada do payload hostil', !hostileB.some((m) => m.text?.includes('Saldo atual')));
  const hostileEvent = await db.conversationEvent.findFirst({ where: { messageId: `${RUN}-hostil-1` } });
  check('evento do payload hostil gravado na conta de A', hostileEvent?.userId === acc.A.userId);

  // "confirmar" pelo WhatsApp de A so atua no rascunho de A
  await deliver(JID.A, 'cancelar');
  await settle();
  check('"cancelar" de A pelo WhatsApp: rascunho WHATSAPP de B e o APP de B intactos', (await waSession('B'))?.version === versionsB.wa && (await appSession('B'))?.version === versionsB.app);

  const after = { A: await domainCounts('A'), B: await domainCounts('B'), C: await domainCounts('C') };
  check('nada foi gravado em nenhuma conta durante os ataques', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);

  // limpa e confirma o proprio rascunho (controle positivo)
  const ownConfirm = await api('POST', '/conversation/confirm', { token: acc.B.token, body: { draftId: draftApp.B.draftId, draftVersion: draftApp.B.draftVersion } });
  check('B confirma o proprio rascunho APP (controle positivo)', ownConfirm.status === 200 && ownConfirm.json?.kind === 'DONE', ownConfirm.text);
  check('so B ganhou transacao', (await txCount('B')) === before.B.tx + 1 && (await txCount('A')) === before.A.tx);
  await deliver(JID.B, 'cancelar');
  await deliver(JID.A, 'cancelar');
  await api('POST', '/conversation/cancel', { token: acc.A.token, body: { draftId: draftApp.A.draftId } });
  await settle();
}

async function s3() {
  section('3. corrida do mesmo usuario (risco aberto do 5a)');
  await flushRate();
  for (let round = 1; round <= 3; round += 1) {
    await flushRate();
    await deliver(JID.A, `51,11 ${cat('A').toLowerCase()}`);
    await settle();
    const draft = await waSession('A');
    check(`rodada ${round}: rascunho WHATSAPP pronto`, draft?.state === 'AWAITING_CONFIRMATION');
    const before = await txCount('A', { amount: 51.11 });
    const calls = [];
    for (let i = 0; i < 5; i += 1) calls.push(api('POST', '/conversation/confirm', { token: acc.A.token, body: { draftId: draft.id, draftVersion: draft.version } }));
    for (let i = 0; i < 5; i += 1) calls.push(deliver(JID.A, i % 2 ? 'confirmar' : 'sim'));
    const outcomes = await Promise.all(calls);
    await settle();
    const created = (await txCount('A', { amount: 51.11 })) - before;
    const statuses = outcomes.slice(0, 5).map((o) => o.status).join(',');
    check(`rodada ${round}: 10 confirmacoes em paralelo (5 app + 5 WhatsApp) = exatamente 1 transacao`, created === 1, `criadas=${created}; status do app: ${statuses}`);
    check(`rodada ${round}: um unico evento com appliedKey`, (await db.conversationEvent.count({ where: { userId: acc.A.userId, appliedKey: `${draft.id}:${draft.version}` } })) === 1);
    check(`rodada ${round}: sessao WHATSAPP consumida`, (await waSession('A')) === null);
    note(`rodada ${round}: status do app = ${statuses}`);
  }

  // duas mensagens diferentes juntas
  const txBase = await txCount('A');
  let writtenWithoutConfirm = 0;
  let invalidSessions = 0;
  const finals = {};
  for (let round = 1; round <= 12; round += 1) {
    await flushRate();
    await deliver(JID.A, 'cancelar');
    await settle();
    // fase 1: sem rascunho, "50 mercado" e "sem categoria" juntos
    await Promise.all([deliver(JID.A, `50 ${cat('A').toLowerCase()}`), deliver(JID.A, 'sem categoria')]);
    await settle();
    const s1v = await waSession('A');
    // fase 2: com categoria pendente ("50 xyz"), tres respostas diferentes juntas
    await deliver(JID.A, 'cancelar');
    await settle();
    await deliver(JID.A, '50 xyzdesconhecido');
    await settle();
    await Promise.all([deliver(JID.A, 'sem categoria'), deliver(JID.A, `50 ${cat('A').toLowerCase()}`), deliver(JID.A, '1')]);
    await settle();
    const s2v = await waSession('A');
    for (const session of [s1v, s2v]) {
      if (session) {
        const draftOk = session.draft && typeof session.draft === 'object' && typeof session.draft.kind === 'string' && Number.isInteger(session.draft.amountCents);
        if (!draftOk || !['COLLECTING_FIELDS', 'AWAITING_CONFIRMATION'].includes(session.state)) invalidSessions += 1;
        const key = `${session.state}/${session.draft?.pendingField ?? 'nenhum'}`;
        finals[key] = (finals[key] ?? 0) + 1;
      } else {
        finals.sem_sessao = (finals.sem_sessao ?? 0) + 1;
      }
    }
  }
  writtenWithoutConfirm = (await txCount('A')) - txBase;
  check('12 rodadas de mensagens concorrentes diferentes: nenhuma gravacao sem confirmacao', writtenWithoutConfirm === 0, `transacoes novas=${writtenWithoutConfirm}`);
  check('12 rodadas: sessao nunca corrompida (estado valido, rascunho JSON valido, uma por canal)', invalidSessions === 0, `invalidas=${invalidSessions}`);
  note(`estados finais observados (2 por rodada): ${JSON.stringify(finals)}`);
  const dupSessions = await db.$queryRaw`SELECT "userId","channel",count(*)::int AS n FROM "ConversationSession" GROUP BY 1,2 HAVING count(*) > 1`;
  check('nunca mais de uma sessao por conta e canal', dupSessions.length === 0);
  await deliver(JID.A, 'cancelar');
  await settle();
}

async function s4() {
  section('4. conversas paralelas A/B/C intercaladas (app e WhatsApp), dono conferido no banco');
  const owner = { A: 11.11, B: 22.22, C: 33.33 };
  const planned = { A: 0, B: 0, C: 0 };
  const replies = [];
  async function flowFor(who, rounds) {
    for (let r = 0; r < rounds; r += 1) {
      const viaApp = r % 2 === 0;
      const amount = String(owner[who]).replace('.', ',');
      const send = async (text) => {
        if (viaApp) {
          const out = await appMsg(who, text);
          replies.push({ who, text: out.text });
          return out.json;
        }
        await deliver(JID[who], text);
        await settle(4000); // como uma pessoa: espera a resposta antes da proxima mensagem
        return null;
      };
      await send('saldo');
      const draft = await send(`${amount} ${cat(who).toLowerCase()}`);
      if (viaApp) {
        const done = await api('POST', '/conversation/confirm', { token: acc[who].token, body: { draftId: draft.draft.draftId, draftVersion: draft.draft.draftVersion } });
        replies.push({ who, text: done.text });
        if (done.status === 200) planned[who] += 1;
      } else {
        await deliver(JID[who], 'confirmar');
        await settle(4000);
        planned[who] += 1;
      }
      await send('metas');
      await send('contas fixas');
      await send('limite');
    }
  }
  const total = { A: await txCount('A', { amount: owner.A }), B: await txCount('B', { amount: owner.B }), C: await txCount('C', { amount: owner.C }) };
  await flushRate();
  await Promise.all(WHO.map((who) => flowFor(who, 4)));
  await settle(12000);
  for (const who of WHO) {
    const got = (await txCount(who, { amount: owner[who] })) - total[who];
    check(`${who}: ${planned[who]} gravacoes pedidas = ${got} no banco`, got === planned[who], `esperado ${planned[who]}`);
    const stray = await db.transaction.count({ where: { amount: owner[who], userId: { not: acc[who].userId } } });
    check(`${who}: nenhuma transacao de valor ${owner[who]} em outra conta`, stray === 0, `fora=${stray}`);
  }
  const wrongCategory = await db.transaction.findMany({ where: { amount: { in: Object.values(owner) } }, select: { userId: true, amount: true, category: { select: { userId: true } } } });
  check('categoria de cada transacao pertence ao mesmo dono da transacao', wrongCategory.every((row) => !row.category || row.category.userId === row.userId));
  const sessions = await db.conversationSession.findMany();
  check('cada sessao pertence a uma das tres contas', sessions.every((row) => WHO.some((who) => acc[who].userId === row.userId)));
  const wrong = replies.filter((entry) => foreignSecrets(entry.who).some((secret) => entry.text.toLowerCase().includes(secret)));
  check('nenhuma resposta do app cita saldo, categoria, meta ou id de outra conta', wrong.length === 0, JSON.stringify(wrong).slice(0, 300));
  const waText = await Promise.all(WHO.map(async (who) => ({ who, sent: (await sentTo(JID[who])).map((m) => m.text).join('\n').toLowerCase() })));
  check('nenhuma resposta enviada ao WhatsApp de uma conta cita dado de outra', waText.every(({ who, sent }) => !foreignSecrets(who).some((secret) => sent.includes(secret))));
  const eventsOk = await db.conversationEvent.count({ where: { userId: { notIn: WHO.map((who) => acc[who].userId) } } });
  check('todo evento pertence a uma das tres contas', eventsOk === 0);
}

async function s5() {
  section('5. reentrega, confirmar duas vezes, alternar JIDs entre contas');
  await flushRate();
  const sentBefore = (await sentTo(JID.C)).length;
  const key = `${RUN}-reentrega-1`;
  await deliver(JID.C, 'saldo', { id: key });
  await settle();
  await deliver(JID.C, 'saldo', { id: key });
  await settle();
  check('mesmo key.id reentregue depois da primeira: uma resposta so', (await sentTo(JID.C)).length - sentBefore === 1);
  check('mesmo key.id duas vezes: um evento so', (await db.conversationEvent.count({ where: { userId: acc.C.userId, channel: 'WHATSAPP', messageId: key } })) === 1);

  // Reentrega SIMULTANEA do mesmo key.id: o WA-AKG nao faz isso, mas registramos o que acontece.
  const parallelKey = `${RUN}-reentrega-paralela`;
  const sentBeforeParallel = (await sentTo(JID.C)).length;
  await Promise.all([deliver(JID.C, 'saldo', { id: parallelKey }), deliver(JID.C, 'saldo', { id: parallelKey }), deliver(JID.C, 'saldo', { id: parallelKey })]);
  await settle();
  note(`reentrega simultanea (3x) do mesmo key.id de uma leitura: ${(await sentTo(JID.C)).length - sentBeforeParallel} resposta(s); eventos: ${await db.conversationEvent.count({ where: { userId: acc.C.userId, messageId: parallelKey } })}`);
  await deliver(JID.C, `47,47 ${cat('C').toLowerCase()}`);
  await settle();
  const before = await txCount('C', { amount: 47.47 });
  const confirmKey = `${RUN}-confirma-1`;
  await Promise.all([deliver(JID.C, 'confirmar', { id: confirmKey }), deliver(JID.C, 'confirmar', { id: confirmKey }), deliver(JID.C, 'sim', { id: `${RUN}-confirma-2` })]);
  await settle();
  check('confirmar em paralelo (mesmo key.id e outra mensagem): 1 transacao', (await txCount('C', { amount: 47.47 })) - before === 1);

  // alternar JIDs: A desvincula, B passa a usar o numero de A
  const unlinkA = await api('DELETE', '/whatsapp/link', { token: acc.A.token });
  const unlinkAAgain = await api('DELETE', '/whatsapp/link', { token: acc.A.token });
  check('DELETE /whatsapp/link idempotente (204 e 204)', unlinkA.status === 204 && unlinkAAgain.status === 204);
  check('desvincular A apagou a sessao WHATSAPP de A e preservou o vinculo de B', (await waSession('A')) === null && Boolean(await db.whatsappLink.findUnique({ where: { userId: acc.B.userId } })));
  await api('DELETE', '/whatsapp/link', { token: acc.B.token });
  const codeB = (await mustOk('codigo B', api('POST', '/whatsapp/link-code', { token: acc.B.token }))).json.code;
  await deliver(JID.A, codeB);
  await settle();
  const linkOfJidA = await db.whatsappLink.findUnique({ where: { jid: JID.A } });
  check('numero antigo de A agora vinculado a B', linkOfJidA?.userId === acc.B.userId);
  const sentBeforeA = (await sentTo(JID.A)).length;
  const txBefore = { A: await txCount('A'), B: await txCount('B') };
  await deliver(JID.A, 'confirmar');
  await deliver(JID.A, 'saldo');
  await settle();
  const newTexts = (await sentTo(JID.A)).slice(sentBeforeA).map((m) => m.text).join('\n');
  const balanceA = await balanceOf('A');
  const balanceB = await balanceOf('B');
  check('o mesmo numero agora responde com o saldo de B e nunca o de A', newTexts.includes(balanceB) && !newTexts.includes(balanceA), `${newTexts} | A=${balanceA} B=${balanceB}`);
  cur.B = JID.A;
  check('B nao herdou a sessao antiga de A nem gravou nada', (await waSession('B')) === null && (await txCount('A')) === txBefore.A && (await txCount('B')) === txBefore.B);
  // o mesmo JID em duas contas: C tenta o JID de A
  const codeC = await api('POST', '/whatsapp/link-code', { token: acc.C.token });
  check('conta ja vinculada (C) nao gera codigo: 409', codeC.status === 409, `${codeC.status} ${codeC.text}`);
  const dupJid = await db.whatsappLink.count({ where: { jid: JID.A } });
  check('o JID de A existe em uma conta so', dupJid === 1);
  // A vincula outro numero (D)
  const codeA = (await mustOk('codigo A', api('POST', '/whatsapp/link-code', { token: acc.A.token }))).json.code;
  await deliver(JID.D, codeA);
  await settle();
  await deliver(JID.D, 'saldo');
  await settle();
  const dTexts = (await sentTo(JID.D)).map((m) => m.text).join('\n');
  cur.A = JID.D;
  check('A vinculou o numero novo (D) e ve so o proprio saldo', dTexts.includes(balanceA) && !dTexts.includes(balanceB), dTexts);
  // webhook: assinatura invalida, ausente e corpo adulterado
  const sentBeforeSig = (await sentAll()).length;
  const bad = await deliver(JID.D, 'saldo', { sign: 'invalid' });
  const none = await deliver(JID.D, 'saldo', { sign: 'none' });
  await settle();
  check('webhook com assinatura invalida e ausente: 401 e sem resposta', bad.status === 401 && none.status === 401 && (await sentAll()).length === sentBeforeSig, `${bad.status} ${none.status}`);
}

async function s6() {
  section('6. logs do backend e do falso');
  const files = [process.env.BACKEND_LOG, process.env.FAKE_LOG].filter((file) => file && existsSync(file));
  if (files.length === 0) {
    note('BACKEND_LOG/FAKE_LOG nao informados: cenario 6 nao executado');
    return;
  }
  const codes = (await db.whatsappLinkCode.findMany({ select: { codeHash: true } })).length;
  const forbidden = new Map();
  const add = (label, value) => value && value.length >= 3 && forbidden.set(label, value.toLowerCase());
  for (const who of WHO) {
    add(`saldo ${who}`, MONEY[who].balance);
    add(`saldo ${who} (numero cru)`, String(MONEY[who].income - MONEY[who].expense));
    add(`categoria ${who}`, cat(who));
    add(`meta ${who}`, goalName(who));
    add(`JID ${who}`, JID[who].split('@')[0]);
  }
  for (const who of WHO) add(`saldo atual ${who}`, await balanceOf(who));
  for (const who of WHO) if (acc[who].lastCode) add(`codigo de vinculo ${who}`, acc[who].lastCode);
  for (const text of ['sem categoria', 'xyzdesconhecido', '51,11', '47,47', '11,11', '22,22', '33,33']) add(`texto "${text}"`, text);
  add('chave da API do falso', process.env.FAKE_API_KEY);
  add('segredo do webhook', WEBHOOK_SECRET);
  add('senha de teste', PASSWORD);
  for (const [index, extra] of (process.env.GREP_SECRETS ?? '').split(',').filter(Boolean).entries()) add(`segredo extra ${index + 1}`, extra);
  for (const id of watchIds) add(`id de rascunho/nota alheio ${id.slice(0, 8)}`, id);
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const hits = [];
    for (const [number, line] of lines.entries()) {
      const lower = line.toLowerCase();
      for (const [label, value] of forbidden) if (lower.includes(value)) hits.push(`${path.basename(file)}:${number + 1} contem ${label}`);
    }
    check(`${path.basename(file)} (${lines.length} linhas): zero ocorrencias de saldo, texto, codigo, chave, segredo, categoria, meta ou numero`, hits.length === 0, hits.slice(0, 8).join(' | '));
    const idHits = [];
    for (const [number, line] of lines.entries()) for (const who of WHO) if (line.includes(acc[who].userId)) idHits.push(`${number + 1}: ${line.replace(acc[who].userId, `<id ${who}>`).slice(0, 140)}`);
    const mixed = lines.filter((line) => WHO.filter((who) => line.includes(acc[who].userId)).length > 1);
    check(`${path.basename(file)}: nenhuma linha mistura ids de duas contas`, mixed.length === 0, mixed.slice(0, 3).join(' | ').slice(0, 300));
    note(`${path.basename(file)}: ${idHits.length} linha(s) com id de conta (o id da propria conta em log operacional): ${idHits.slice(0, 3).join(' || ')}`);
  }
  note(`codigos de vinculo no banco: ${codes}`);
}

async function s7(writes) {
  section(`7. WHATSAPP_WRITES_ENABLED=${writes}: nenhum tipo de rascunho grava por mensagem do WhatsApp`);
  await flushRate();
  const KINDS = [
    ['despesa', `61 ${cat('A').toLowerCase()}`],
    ['receita', 'recebi 100 salario zeta'],
    ['meta', 'criar meta carro 2 mil'],
    ['cofrinho', 'criar cofrinho emergencia'],
    ['aporte', `guardar 200 na ${goalName('A').toLowerCase()}`],
    ['reserva', 'criar reserva 400 gasolina'],
    ['limite do cartao', 'definir limite do cartão 5000'],
    ['conta fixa', 'criar conta fixa 120 internet mensal primeiro 20/12/2026'],
    ['parcela', 'criar parcelado 1200 geladeira em 12x primeiro 20/12/2026'],
  ];
  const CONFIRMS = ['confirmar', 'Confirmar', 'CONFIRMAR', 'confirmár', 'Confirmar!', ' confirmar ', 'sim', 'SIM', 'ok', 'OK', ' ok '];
  for (const [kind, text] of KINDS) {
    await flushRate();
    await deliver(cur.A, 'cancelar');
    await settle();
    const before = await domainCounts('A');
    await deliver(cur.A, text);
    await settle();
    const draft = await waSession('A');
    const awaiting = draft?.state === 'AWAITING_CONFIRMATION';
    check(`rascunho de ${kind} aguardando confirmacao no WhatsApp`, awaiting, `estado=${draft?.state}`);
    for (const word of CONFIRMS) await deliver(cur.A, word);
    await settle();
    const after = await domainCounts('A');
    if (writes) {
      check(`WRITES=true, ${kind}: o primeiro "confirmar" gravou`, JSON.stringify(after) !== JSON.stringify(before), JSON.stringify(after));
      continue;
    }
    check(`WRITES=false, ${kind}: nenhuma variacao de "confirmar" gravou`, JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    check(`WRITES=false, ${kind}: rascunho continua aguardando`, (await waSession('A'))?.state === 'AWAITING_CONFIRMATION');
  }
  if (!writes) {
    const texts = (await sentTo(cur.A)).map((m) => m.text);
    check('WRITES=false: as respostas mandam confirmar no app', texts.some((text) => text.includes('app')));
    // botao do app: grava (D9, desenho)
    await deliver(cur.A, 'cancelar');
    await settle();
    await deliver(cur.A, `62,62 ${cat('A').toLowerCase()}`);
    await settle();
    const session = await api('GET', '/conversation/session', { token: acc.A.token });
    const before = await txCount('A', { amount: 62.62 });
    const confirmed = await api('POST', '/conversation/confirm', { token: acc.A.token, body: { draftId: session.json.draft.draftId, draftVersion: session.json.draft.draftVersion } });
    check('WRITES=false: o botao do app grava o rascunho do WhatsApp (D9, decisao de desenho)', confirmed.status === 200 && (await txCount('A', { amount: 62.62 })) - before === 1, confirmed.text);
    const intruder = await api('POST', '/conversation/confirm', { token: acc.B.token, body: { draftId: session.json.draft.draftId, draftVersion: session.json.draft.draftVersion } });
    check('depois de consumido, outra conta nao consegue confirmar o mesmo id', intruder.status === 404);
  }
}

// ---------- execucao ----------
try {
  console.log(`# isolamento-real: fase=${PHASE} WRITES=${WRITES} rodada=${RUN}`);
  await setupAccountsAndRun();
} catch (error) {
  check('execucao sem excecao', false, String(error?.stack ?? error));
} finally {
  await db.$disconnect();
  redis.disconnect();
  const failed = results.filter((item) => !item.ok);
  console.log(`\n# resumo: ${results.length - failed.length} PASS, ${failed.length} FAIL`);
  for (const item of failed) console.log(`FAIL  ${item.name}`);
  process.exit(failed.length ? 1 : 0);
}

async function setupAccountsAndRun() {
  if (PHASE === 'writes-true') {
    if (!WRITES) throw new Error('PHASE=writes-true exige WRITES=true');
    await s1();
    await s2();
    await s3();
    await s4();
    await s5();
    await s7(true);
    await s6();
  } else if (PHASE === 'writes-false') {
    if (WRITES) throw new Error('PHASE=writes-false exige WRITES=false');
    await setupAccounts();
    await linkAll();
    await s7(false);
    await s6();
  } else {
    throw new Error('PHASE deve ser writes-true ou writes-false');
  }
}
