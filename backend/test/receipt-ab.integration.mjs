// Cenário A/B manual contra a API real (dist/main) com Postgres e Redis descartáveis.
// Uso: BASE=http://localhost:3999/api/v1 node test/receipt-ab.integration.mjs
// Só dados sintéticos (fixtures de test/fixtures/receipts). Não faz parte do jest.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE ?? 'http://localhost:3999/api/v1';
const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'receipts');
const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8'))[0];
let failures = 0;

function check(name, ok, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${extra}`);
}

async function call(method, path, token, body, form) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // corpo não JSON
  }
  return { status: res.status, json, text };
}

async function newUser(tag) {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `rev-${tag}-${suffix}@example.test`;
  const reg = await call('POST', '/auth/register', null, {
    name: `Rev ${tag}`,
    email,
    password: 'Senha!Forte123',
    privacyNoticeAccepted: true,
  });
  if (reg.status >= 300) throw new Error(`register ${tag}: ${reg.status} ${reg.text}`);
  const token = reg.json.accessToken ?? reg.json.tokens?.accessToken;
  const group = await call('POST', '/tag-groups', token, { name: `Grupo ${tag}` });
  if (group.status >= 300) throw new Error(`tag-group ${tag}: ${group.status} ${group.text}`);
  return { token, groupId: group.json.id };
}

function form(user, file = 'nota-n1.png', mime = 'image/png') {
  const f = new FormData();
  f.set('tagGroupId', user.groupId);
  f.set('file', new Blob([readFileSync(join(dir, file))], { type: mime }), file);
  return f;
}

const preview = (u, file, mime) => call('POST', '/imports/receipts/preview', u.token, null, form(u, file, mime));
const commit = (u, body) => call('POST', '/imports/receipts/commit', u.token, body);

const A = await newUser('a');
const B = await newUser('b');

// A importa a nota com a chave K.
const a1 = await preview(A);
check('A preview 201', a1.status === 201, `status=${a1.status}`);
check('A chave K lida', a1.json?.accessKeyValid === true, `accessKeyValid=${a1.json?.accessKeyValid}`);
check('A sem duplicata na 1ª vez', a1.json?.possibleDuplicate === false);
const a1c = await commit(A, { receiptScanId: a1.json.receiptScanId });
check('A commit 201 (corpo antigo, sem acknowledgeDuplicate)', a1c.status === 201, `status=${a1c.status}`);

// B importa a mesma nota (mesma chave K): não bloqueia e não vê nada de A.
const b1 = await preview(B);
check('B preview 201', b1.status === 201, `status=${b1.status}`);
check('B possibleDuplicate false', b1.json?.possibleDuplicate === false, `possibleDuplicate=${b1.json?.possibleDuplicate}`);
check('B sem descrição de duplicata de A', !b1.json?.duplicateTransactionId && !b1.json?.duplicateTransactionDescription);
const b1c = await commit(B, { receiptScanId: b1.json.receiptScanId });
check('B commit 201 sem bloqueio', b1c.status === 201, `status=${b1c.status}`);

// B tenta comitar a nota de A e uma inexistente: 404 idêntico.
const a2 = await preview(A);
check('A 2ª prévia marca duplicata pela chave', a2.json?.possibleDuplicate === true);
const bSteal = await commit(B, { receiptScanId: a2.json.receiptScanId, acknowledgeDuplicate: true });
const bGhost = await commit(B, { receiptScanId: 'id-que-nao-existe', acknowledgeDuplicate: true });
check('B comitar nota de A = 404', bSteal.status === 404, `status=${bSteal.status}`);
// Timestamp, path e requestId mudam a cada chamada; o resto do corpo precisa ser igual.
const stable = ({ timestamp, requestId, ...rest }) => JSON.stringify(rest);
check('404 de A idêntico ao de inexistente', stable(bSteal.json) === stable(bGhost.json), `${bSteal.text} | ${bGhost.text}`);

// B listando não vê a prévia de A.
const bList = await call('GET', '/imports/receipts', B.token);
const bIds = JSON.stringify(bList.json);
check('B lista não contém a prévia de A', !bIds.includes(a2.json.receiptScanId));

// A: duplicata exige decisão.
const a2c = await commit(A, { receiptScanId: a2.json.receiptScanId });
check('A sem acknowledge = 409 RECEIPT_DUPLICATE_UNCONFIRMED', a2c.status === 409 && a2c.json?.code === 'RECEIPT_DUPLICATE_UNCONFIRMED', `status=${a2c.status} body=${a2c.text}`);
const a2d = await commit(A, { receiptScanId: a2.json.receiptScanId, acknowledgeDuplicate: false });
check('A acknowledge=false = 409', a2d.status === 409);
const a2ok = await commit(A, { receiptScanId: a2.json.receiptScanId, acknowledgeDuplicate: true });
check('A com acknowledge=true = 201', a2ok.status === 201, `status=${a2ok.status}`);

// Erros do extrator chegam com code pelo filtro real.
const heic = await call('POST', '/imports/receipts/preview', A.token, null, (() => {
  const f = new FormData();
  f.set('tagGroupId', A.groupId);
  const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(40)]);
  f.set('file', new Blob([bytes], { type: 'image/heic' }), 'x.heic');
  return f;
})());
check('HEIC = 400 com mensagem', heic.status === 400 && /HEIC/.test(heic.text), `status=${heic.status} ${heic.text}`);
const scanned = await preview(A, 'nota-n1-digitalizada.pdf', 'application/pdf');
check('PDF digitalizado = 400', scanned.status === 400 && /imagem digitalizada/.test(scanned.text), `status=${scanned.status} ${scanned.text}`);

// Privacidade: nenhuma resposta contém CPF-like (não há CPF nas fixtures; confere rawTextExcerpt <= 500).
check('rawTextExcerpt <= 500', (a1.json?.rawTextExcerpt ?? '').length <= 500, `len=${(a1.json?.rawTextExcerpt ?? '').length}`);

console.log(failures === 0 ? 'TUDO OK' : `${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
