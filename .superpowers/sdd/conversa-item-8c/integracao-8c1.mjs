// Integracao real da 8c-1 (editar/apagar contas fixas e parcelados por conversa) contra
// Postgres 18 e Redis 7 descartaveis (portas 5545/6391). Nada toca o 5433 legado.
const BASE = 'http://localhost:3211/api/v1';
let okCount = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) okCount += 1;
  else fails.push(name + (extra ? ` | ${String(extra).slice(0, 180)}` : ''));
};
const uuid = () => crypto.randomUUID();

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, json };
}

let msgSeq = 0;
async function say(token, text) {
  msgSeq += 1;
  return api('POST', '/conversation/message', token, { messageId: uuid(), text });
}

(async () => {
  const a = await api('POST', '/auth/register', undefined, { name: 'Integr A', email: `a8c1-${Date.now()}@ex.com`, password: 'Senha-Forte-123', privacyNoticeAccepted: true });
  const b = await api('POST', '/auth/register', undefined, { name: 'Integr B', email: `b8c1-${Date.now()}@ex.com`, password: 'Senha-Forte-123', privacyNoticeAccepted: true });
  const tA = a.json?.accessToken;
  const tB = b.json?.accessToken;
  if (!tA || !tB) {
    console.log('FATAL register:', JSON.stringify(a.json).slice(0, 200), JSON.stringify(b.json).slice(0, 200));
    process.exit(1);
  }
  check('contas A e B registradas', true);

  // alvos reais (pela tela/API): conta fixa com vencimento passado gera lancamento na hora
  const netflix = (await api('POST', '/recurring-transactions', tA, { type: 'EXPENSE', description: 'Netflix ic', amount: 55.9, frequency: 'MONTHLY', firstDueDate: '2026-11-20' })).json;
  const ferias = (await api('POST', '/recurring-transactions', tA, { type: 'EXPENSE', description: 'Netflix das ferias ic', amount: 30, frequency: 'MONTHLY', firstDueDate: '2026-12-05' })).json;
  const netflixB = (await api('POST', '/recurring-transactions', tB, { type: 'EXPENSE', description: 'Netflix ic de B', amount: 40, frequency: 'MONTHLY', firstDueDate: '2026-12-01' })).json;
  check('contas fixas criadas', !!netflix?.id && !!ferias?.id && !!netflixB?.id, JSON.stringify(netflix)?.slice(0, 120));
  await api('PATCH', `/recurring-transactions/${ferias.id}`, tA, { isActive: false });
  const cobranca = (await api('GET', '/transactions', tA)).json;
  const linkRecA = cobranca.length ?? 0;
  check('geracao imediata da conta fixa vencida', (cobranca ?? []).some((t) => (t.description ?? '').includes('Netflix ic')), JSON.stringify(cobranca)?.slice(0, 160));

  const tv = (await api('POST', '/installments', tA, { description: 'TV ic 50', totalAmount: 3600, installmentsTotal: 12, firstDueDate: '2026-11-21' })).json;
  const tvB = (await api('POST', '/installments', tB, { description: 'TV ic de B', totalAmount: 1200, installmentsTotal: 4, firstDueDate: '2026-12-01' })).json;
  check('parcelados criados', !!tv?.id && !!tvB?.id, JSON.stringify(tv)?.slice(0, 140));

  // 1) lista de contas fixas: do dono, pausada incluida, sem vazao de B
  const lista = await say(tA, 'apagar conta fixa netflix');
  check('lista conta fixa com pausada', (lista.json?.text ?? '').includes('Netflix ic') && (lista.json?.text ?? '').includes('pausada'), JSON.stringify(lista.json)?.slice(0, 220));
  check('lista nao vaza a conta de B', !(lista.json?.text ?? '').includes('Netflix ic de B'));
  await say(tA, 'cancelar');

  // 2) editar valor e data final pelo chat, aplicado no banco real
  await say(tA, 'editar conta fixa netflix ic');
  await say(tA, '1');
  const prevEdit = await say(tA, 'valor 70');
  const linhaValor = (prevEdit.json?.draft?.rows ?? []).find((r) => r.label === 'Valor');
  check('previa antes -> depois real', /55,90.*70,00/.test(linhaValor?.value ?? ''), JSON.stringify(prevEdit.json?.draft?.rows));
  await say(tA, 'confirmar');
  const aposEdit = (await api('GET', '/recurring-transactions', tA)).json.find((r) => r.id === netflix.id);
  check('valor gravado no banco', Number(aposEdit?.amount) === 70, aposEdit?.amount);

  await say(tA, 'editar conta fixa netflix ic');
  await say(tA, '1');
  await say(tA, 'data final 20/12/2027');
  await say(tA, 'confirmar');
  const comData = (await api('GET', '/recurring-transactions', tA)).json.find((r) => r.id === netflix.id);
  check('data final gravada', String(comData?.endDate ?? '').startsWith('2027-12-20'), JSON.stringify(comData?.endDate));

  // 3) conflito real: tela mexe no meio do apagar
  await say(tA, 'apagar conta fixa netflix ic');
  await say(tA, '1');
  await api('PATCH', `/recurring-transactions/${netflix.id}`, tA, { description: 'Netflix ic 2' });
  const confl = await say(tA, 'apagar');
  check('apagar confere updatedAt real', (confl.json?.text ?? '').includes('mudou desde que você escolheu'), JSON.stringify(confl.json)?.slice(0, 160));
  check('conta do conflito segue viva', (await api('GET', '/recurring-transactions', tA)).json.some((r) => r.id === netflix.id));

  // 4) apagar limpo com RESTORED no meio (confirmao via API com flag, como o botao)
  await say(tA, 'apagar conta fixa netflix ic 2');
  await say(tA, '1');
  const sessaoA = await api('GET', '/conversation/session', tA);
  const dA = sessaoA.json?.draft;
  check('RESTORED do apagar de conta fixa', dA?.changeAction === 'DELETE' && (dA?.rows ?? []).some((r) => r.label === 'Aviso'), JSON.stringify(dA?.rows)?.slice(0, 200));
  const semFlag = await api('POST', '/conversation/confirm', tA, { draftId: dA.draftId, draftVersion: dA.draftVersion });
  check('confirm sem flag nao apaga', semFlag.json?.kind === 'ERROR' && (semFlag.json?.text ?? '').includes('responda apagar'));
  const comFlag = await api('POST', '/conversation/confirm', tA, { draftId: dA.draftId, draftVersion: dA.draftVersion, delete: true });
  check('flag explicita apaga a conta', comFlag.json?.kind === 'DONE' && (comFlag.json?.text ?? '').includes('Apaguei a conta fixa'), JSON.stringify(comFlag.json)?.slice(0, 160));
  check('conta sumiu do banco', !(await api('GET', '/recurring-transactions', tA)).json.some((r) => r.id === netflix.id));

  // 5) editar parcelado: recusa sem sessao (D3); apagar parcelado pelo chat
  const recusa = await say(tA, 'editar parcelado tv ic');
  check('editar parcelado recusado', recusa.json?.kind === 'INFO' && (recusa.json?.text ?? '').includes('não tem edição'), JSON.stringify(recusa.json)?.slice(0, 140));
  const sessaoVazia = await api('GET', '/conversation/session', tA);
  check('recusa nao abriu sessao', sessaoVazia.json?.state === 'IDLE');
  await say(tA, 'apagar parcelado tv ic');
  await say(tA, '1');
  const delTv = await say(tA, 'apagar');
  check('apagar parcelado conclui', delTv.json?.kind === 'DONE' && (delTv.json?.text ?? '').includes('Apaguei a compra parcelada'), JSON.stringify(delTv.json)?.slice(0, 160));
  check('parcelado sumiu do banco', !(await api('GET', '/installments', tA)).json.some((r) => r.id === tv.id));
  const extrato = (await api('GET', '/transactions', tA)).json;
  check('parcela gerada ficou no extrato', (extrato ?? []).some((t) => (t.description ?? '').includes('TV ic 50')), JSON.stringify(extrato)?.slice(0, 200));

  // 6) isolamento real: B tenta confirmar rascunho de A
  await say(tA, 'apagar conta fixa netflix das ferias');
  await say(tA, '1');
  const draftA = (await api('GET', '/conversation/session', tA)).json?.draft;
  const rob = await api('POST', '/conversation/confirm', tB, { draftId: draftA.draftId, draftVersion: draftA.draftVersion, delete: true });
  check('B confirma rascunho de A: 404', rob.status === 404, `${rob.status} ${JSON.stringify(rob.json)?.slice(0, 100)}`);
  await say(tA, 'cancelar');
  check('conta de B intacta', (await api('GET', '/recurring-transactions', tB)).json.some((r) => r.id === netflixB.id));
  check('parcelado de B intacto', (await api('GET', '/installments', tB)).json.some((r) => r.id === tvB.id));

  // 7) cancelar nao grava; "conta" sozinho segue sendo lancamento (D1)
  await say(tA, 'editar conta fixa netflix das ferias');
  await say(tA, '1');
  await say(tA, 'valor 5');
  const cancel = await say(tA, 'cancelar');
  check('cancelar descarta', cancel.json?.kind === 'CANCELLED');
  const feriasApos = (await api('GET', '/recurring-transactions', tA)).json.find((r) => r.id === ferias.id);
  check('cancelar nao gravou', Number(feriasApos?.amount) === 30, feriasApos?.amount);
  const d1 = await say(tA, 'apagar conta');
  check('D1: "conta" sozinho segue no lancamento', (d1.json?.text ?? '').includes('Qual lançamento?'), JSON.stringify(d1.json)?.slice(0, 120));

  void linkRecA;
  console.log(`\nCHECKS OK: ${okCount} | FALHAS: ${fails.length}`);
  for (const f of fails) console.log('FALHA:', f);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error('ERRO FATAL:', error);
  process.exit(2);
});
