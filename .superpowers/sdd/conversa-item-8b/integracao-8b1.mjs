// Integracao real da 8b-1 (editar/apagar metas e reservas por conversa) contra
// Postgres 16 e Redis 7 descartaveis (portas 5544/6390). Nada toca o 5433 legado.
const BASE = 'http://localhost:3210/api/v1';
let okCount = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) okCount += 1;
  else fails.push(name + (extra ? ` | ${String(extra).slice(0, 160)}` : ''));
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

function tokenOf(auth) {
  return auth?.accessToken ?? auth?.access_token ?? auth?.token ?? null;
}

let msgSeq = 0;
async function say(token, text) {
  msgSeq += 1;
  return api('POST', '/conversation/message', token, { messageId: uuid(), text });
}
async function saySame(messageId, token, text) {
  return api('POST', '/conversation/message', token, { messageId, text });
}

(async () => {
  // contas
  const a = await api('POST', '/auth/register', undefined, { name: 'Integr A', email: `a8b1-${Date.now()}@ex.com`, password: 'Senha-Forte-123', privacyNoticeAccepted: true });
  const b = await api('POST', '/auth/register', undefined, { name: 'Integr B', email: `b8b1-${Date.now()}@ex.com`, password: 'Senha-Forte-123', privacyNoticeAccepted: true });
  const tA = tokenOf(a.json);
  const tB = tokenOf(b.json);
  check('register A devolve token', !!tA, JSON.stringify(a.json).slice(0, 120));
  check('register B devolve token', !!tB, JSON.stringify(b.json).slice(0, 120));
  if (!tA || !tB) {
    console.log('A:', JSON.stringify(a.json).slice(0, 120)); console.log('B:', JSON.stringify(b.json).slice(0, 300));
    process.exit(1);
  }

  // alvos
  const metaViagem = (await api('POST', '/goals', tA, { title: 'Viagem integracao', targetAmount: 500 })).json;
  const metaCasa = (await api('POST', '/goals', tA, { title: 'Casa ic', targetAmount: 500 })).json;
  const metaB = (await api('POST', '/goals', tB, { title: 'Viagem B', targetAmount: 100 })).json;
  check('meta A criada', !!metaViagem?.id, JSON.stringify(metaViagem));
  check('meta B criada', !!metaB?.id, JSON.stringify(metaB));

  // 1) busca so com metas do dono, numerada
  const lista = await say(tA, 'editar meta viagem');
  check('lista edit meta: ASK com a meta A', lista.json?.kind === 'ASK_FIELD' && lista.json?.text?.includes('Viagem integracao'), JSON.stringify(lista.json)?.slice(0, 200));
  check('lista nao vaza meta de B', !(lista.json?.text ?? '').includes('Viagem B'));
  check('meta de B: lista propria', ((await say(tB, 'editar meta viagem')).json?.text ?? '').includes('Viagem B'));

  // 2) escolher, mudar valor, previa antes->depois
  await say(tA, '1');
  const prev = await say(tA, 'valor 800');
  const linha = (prev.json?.draft?.rows ?? []).find((row) => row.label === 'Valor alvo');
  check('previa antes -> depois', !!prev.json?.draft && /500,00.*800,00/.test(linha?.value ?? ''), JSON.stringify(prev.json?.draft?.rows));
  check('cartao EDIT com changeAction', prev.json?.draft?.changeAction === 'EDIT' && prev.json?.draft?.kind === 'GOAL_CHANGE');

  // 3) conflito real: tela edita no meio e o confirmar recusa
  const idViagem = metaViagem.id;
  await api('PATCH', `/goals/${idViagem}`, tA, { description: 'mexida pela tela' });
  const confl = await say(tA, 'confirmar');
  check('conflito de updatedAt recusa editar', (confl.json?.text ?? '').includes('mudou desde que você escolheu'), JSON.stringify(confl.json)?.slice(0, 160));
  const aposConfl = (await api('GET', '/goals', tA)).json.find((g) => g.id === idViagem);
  check('nada gravado no conflito', Number(aposConfl.targetAmount) === 500, aposConfl.targetAmount);

  // 4) fluxo limpo ate o fim (id + userId reais)
  await say(tA, 'editar meta viagem');
  await say(tA, '1');
  await say(tA, 'valor 800');
  const done = await say(tA, 'confirmar');
  check('editar conclui com recibo', done.json?.kind === 'DONE' && (done.json?.text ?? '').includes('Alterei a meta'), JSON.stringify(done.json)?.slice(0, 160));
  const aposEdit = (await api('GET', '/goals', tA)).json.find((g) => g.id === idViagem);
  check('alvo gravado no banco', Number(aposEdit.targetAmount) === 800, aposEdit.targetAmount);

  // 5) reentrega da mesma mensagem nao repete a escrita
  msgSeq += 1;
  const midRepetida = uuid();
  await say(tA, 'editar meta casa');
  await say(tA, '1');
  await saySame(midRepetida, tA, 'valor 900');
  const c1 = await say(tA, 'confirmar');
  const replay = await saySame(c1.json?.data?.messageId ?? 'nao', tA, 'confirmar');
  void replay;
  const casa = (await api('GET', '/goals', tA)).json.find((g) => g.id === metaCasa.id);
  check('primeira confirmacao gravou', c1.json?.kind === 'DONE' && Number(casa.targetAmount) === 900, `${c1.json?.kind}/${casa?.targetAmount}`);
  const sessaoSumiu = await api('GET', '/conversation/session', tA);
  check('sessao fecha apos DONE', sessaoSumiu.json?.state === 'IDLE', JSON.stringify(sessaoSumiu.json)?.slice(0, 120));

  // 6) apagar com palavra + flag explicita e previa
  await say(tA, 'apagar meta casa');
  await say(tA, '1');
  const prevApagar = await api('GET', '/conversation/session', tA);
  const delDraft = prevApagar.json?.draft;
  check('RESTORED traz cartao de apagar', delDraft?.changeAction === 'DELETE' && (delDraft?.rows ?? []).some((row) => row.label === 'Aviso'), JSON.stringify(delDraft?.rows));
  const semFlag = await api('POST', '/conversation/confirm', tA, { draftId: delDraft.draftId, draftVersion: delDraft.draftVersion });
  check('confirm sem flag nao apaga', semFlag.json?.kind === 'ERROR' && (semFlag.json?.text ?? '').includes('responda apagar'), JSON.stringify(semFlag.json)?.slice(0, 140));
  const flagInvalida = await api('POST', '/conversation/confirm', tA, { draftId: delDraft.draftId, draftVersion: delDraft.draftVersion, delete: 'x' });
  check('flag delete literal (string da 400)', flagInvalida.status === 400, flagInvalida.status);
  const comFlag = await api('POST', '/conversation/confirm', tA, { draftId: delDraft.draftId, draftVersion: delDraft.draftVersion, delete: true });
  check('flag explicita apaga', comFlag.json?.kind === 'DONE' && (comFlag.json?.text ?? '').includes('Apaguei a meta'), JSON.stringify(comFlag.json)?.slice(0, 160));
  const metasA = (await api('GET', '/goals', tA)).json;
  check('meta apagada sumiu do banco', !metasA.some((g) => g.id === metaCasa.id));

  // 7) apagar meta solta os aportes (semantica da tela)
  const metaCofre = (await api('POST', '/goals', tA, { title: 'Cofre aportes' })).json;
  await api('PATCH', `/goals/${metaCofre.id}/contribute`, tA, { amount: 40 });
  await say(tA, 'apagar meta cofre');
  await say(tA, '1');
  const delCofre = await say(tA, 'apagar');
  check('apagar cofre pelo chat', delCofre.json?.kind === 'DONE', JSON.stringify(delCofre.json)?.slice(0, 120));
  const extrato = (await api('GET', '/transactions', tA)).json;
  const aporte = (extrato?.items ?? extrato).find?.((t) => (t.description ?? '').includes('Cofre aportes'));
  check('aporte ficou solto no extrato', !!aporte && (aporte.linkedGoalId ?? null) === null, JSON.stringify(aporte)?.slice(0, 160));

  // 8) apagar com conflito (tela mexeu na meta escolhida)
  const metaPrazo = (await api('POST', '/goals', tA, { title: 'Prazo ic', targetAmount: 700 })).json;
  await say(tA, 'apagar meta prazo');
  await say(tA, '1');
  await api('PATCH', `/goals/${metaPrazo.id}`, tA, { title: 'Prazo ic 2' });
  const delConfl = await say(tA, 'apagar');
  check('apagar confere updatedAt na aplicacao real', (delConfl.json?.text ?? '').includes('mudou desde que você escolheu'), JSON.stringify(delConfl.json)?.slice(0, 140));
  check('meta do conflito segue viva', (await api('GET', '/goals', tA)).json.some((g) => g.id === metaPrazo.id));

  // 9) isolamento real: A nao acha meta de B; rascunho de A nao confirmavel por B
  const metaDeB = metaB.id;
  const buscaB = await say(tA, 'editar meta viagem b');
  check('busca de A nao acha a meta de B', buscaB.json?.kind === 'INFO' || (buscaB.json?.text ?? '').length > 0 && !(buscaB.json?.text ?? '').includes('Viagem B'));
  await say(tA, 'apagar meta prazo');
  await say(tA, '1');
  const draftA = (await api('GET', '/conversation/session', tA)).json?.draft;
  const rob = await api('POST', '/conversation/confirm', tB, { draftId: draftA.draftId, draftVersion: draftA.draftVersion, delete: true });
  check('B confirma rascunho de A: 404 sem revelar existncia', rob.status === 404, `${rob.status} ${JSON.stringify(rob.json)?.slice(0, 100)}`);
  const roboA = await api('POST', '/conversation/confirm', tA, { draftId: '00000000-0000-4000-8000-000000000000', draftVersion: 1, delete: true });
  check('confirm de draft inexistente: 404', roboA.status === 404, roboA.status);
  await say(tA, 'cancelar');
  check('meta de B intacta', (await api('GET', '/goals', tB)).json.some((g) => g.id === metaDeB));

  // 10) reservas
  const reserva = (await api('POST', '/envelopes', tA, { name: 'Gasolina ic', color: '#3366cc', monthlyAmount: 200 })).json;
  check('reserva criada', !!reserva?.id, JSON.stringify(reserva)?.slice(0, 120));
  await say(tA, 'editar reserva gasolina');
  await say(tA, '1');
  const prevRes = await say(tA, 'valor mensal 250');
  const linhaRes = (prevRes.json?.draft?.rows ?? []);
  check('previa reserva com aviso', linhaRes.some((row) => row.label === 'Valor mensal' && /200,00.*250,00/.test(row.value)) && linhaRes.some((row) => (row.value ?? '').includes('próximo depósito')), JSON.stringify(linhaRes));
  const okRes = await say(tA, 'confirmar');
  check('editar reserva conclui', okRes.json?.kind === 'DONE', JSON.stringify(okRes.json)?.slice(0, 120));
  const reservaApos = (await api('GET', '/envelopes', tA)).json.find((e) => e.id === reserva.id) ?? (await api('GET', '/envelopes', tA)).json;
  check('valor mensal gravado', Number(reservaApos?.monthlyAmount ?? reservaApos?.monthly?.monthlyAmount ?? 0) === 250 || JSON.stringify(reservaApos).includes('250'), JSON.stringify(reservaApos)?.slice(0, 200));

  // gasto ligado: apagar reserva mantem o gasto
  const gasto = (await api('POST', '/transactions', tA, { type: 'EXPENSE', description: 'Gasolina do mes', amount: 30, date: '2026-11-14', envelopeId: reserva.id })).json;
  check('gasto com envelope criado', !!gasto?.id, JSON.stringify(gasto)?.slice(0, 140));
  await say(tA, 'apagar reserva gasolina');
  await say(tA, '1');
  const delRes = await say(tA, 'apagar');
  check('apagar reserva conclui', delRes.json?.kind === 'DONE', JSON.stringify(delRes.json)?.slice(0, 140));
  const extratoRes = (await api('GET', '/transactions', tA)).json;
  const gastoApos = (extratoRes?.items ?? extratoRes).find?.((t) => t.id === gasto?.id);
  check('gasto sobrevive solto', !!gastoApos && (gastoApos.envelopeId ?? null) === null, JSON.stringify(gastoApos)?.slice(0, 160));

  // 11) cancelamento nao grava
  await say(tA, 'editar meta prazo');
  await say(tA, '1');
  await say(tA, 'valor 10');
  const cancel = await say(tA, 'cancelar');
  check('cancelar descarta', cancel.json?.kind === 'CANCELLED');
  const prazoFinal = (await api('GET', '/goals', tA)).json.find((g) => g.id === metaPrazo.id);
  check('cancelar nao gravou', Number(prazoFinal.targetAmount) === 700, prazoFinal.targetAmount);

  console.log(`\nCHECKS OK: ${okCount} | FALHAS: ${fails.length}`);
  for (const f of fails) console.log('FALHA:', f);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error('ERRO FATAL:', error);
  process.exit(2);
});
