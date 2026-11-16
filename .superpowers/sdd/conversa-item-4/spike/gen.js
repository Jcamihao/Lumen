// Gera notas sinteticas (fictícias) com gabarito. Nada aqui é dado real.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const QRCode = require('qrcode');

let seed = 20261116;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const money = (n) => n.toFixed(2).replace('.', ',');
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const lpad = (s, n) => String(s).padStart(n);

function mod11(digits) {
  let w = 2, sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) { sum += Number(digits[i]) * w; w = w === 9 ? 2 : w + 1; }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}
function cnpj() {
  const base = Array.from({ length: 8 }, () => Math.floor(rnd() * 10)).join('') + '0001';
  const calc = (b) => {
    const ws = b.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const s = b.split('').reduce((a, d, i) => a + Number(d) * ws[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base); const d2 = calc(base + d1); return base + d1 + d2;
}
const fmtCnpj = (c) => `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}/${c.slice(8,12)}-${c.slice(12)}`;
function chave(c, yymm, nf) {
  const body = '35' + yymm + c + '65' + '001' + String(nf).padStart(9, '0') + '1' + String(Math.floor(rnd()*1e8)).padStart(8, '0');
  return body + mod11(body);
}

const MERCHANTS = ['SUPERMERCADO BOM PRECO LTDA', 'FARMACIA SAUDE VIVA LTDA', 'POSTO ESTRELA DO SUL LTDA', 'PADARIA PAO DOURADO ME', 'MERCADINHO DA ESQUINA LTDA', 'RESTAURANTE SABOR CASEIRO ME'];
const PRODUCTS = [
  ['ARROZ TIPO 1 5KG', 24.9, 'UN'], ['FEIJAO CARIOCA 1KG', 8.49, 'UN'], ['LEITE INTEGRAL 1L', 5.79, 'UN'],
  ['CAFE TORRADO 500G', 18.9, 'UN'], ['ACUCAR REFINADO 1KG', 4.99, 'UN'], ['OLEO DE SOJA 900ML', 7.35, 'UN'],
  ['BANANA PRATA', 6.99, 'KG'], ['FILE DE FRANGO', 17.5, 'KG'], ['PAO FRANCES', 14.9, 'KG'], ['DETERGENTE 500ML', 2.89, 'UN'],
  ['PAPEL HIGIENICO 12UN', 19.9, 'UN'], ['SABONETE 90G', 2.49, 'UN'], ['REFRIGERANTE COLA 2L', 9.99, 'UN'], ['MACARRAO ESPAGUETE 500G', 4.59, 'UN'],
];

function makeReceipt(i) {
  const merchant = MERCHANTS[i % MERCHANTS.length];
  const c = cnpj();
  const day = 1 + Math.floor(rnd() * 27), month = 1 + Math.floor(rnd() * 11), year = 2026;
  const dd = String(day).padStart(2, '0'), mm = String(month).padStart(2, '0');
  const nItems = 3 + Math.floor(rnd() * 9);
  const used = new Set(); const items = [];
  while (items.length < nItems) {
    const p = pick(PRODUCTS); if (used.has(p[0])) continue; used.add(p[0]);
    const qty = p[2] === 'KG' ? Math.round((0.3 + rnd() * 2.2) * 1000) / 1000 : 1 + Math.floor(rnd() * 4);
    const unit = p[1]; const total = Math.round(qty * unit * 100) / 100;
    items.push({ desc: p[0], qty, un: p[2], unit, total });
  }
  const total = Math.round(items.reduce((a, b) => a + b.total, 0) * 100) / 100;
  const nf = 100000 + Math.floor(rnd() * 800000);
  const key = chave(c, String(year).slice(2) + mm, nf);
  return { merchant, cnpj: c, date: `${dd}/${mm}/${year}`, items, total, nf, key };
}

function receiptLines(r) {
  const W = 44;
  const L = [];
  L.push(r.merchant, `CNPJ: ${fmtCnpj(r.cnpj)}`, 'RUA DAS FLORES 100 - CENTRO', 'DANFE NFC-e - DOCUMENTO AUXILIAR DA', 'NOTA FISCAL DE CONSUMIDOR ELETRONICA', '-'.repeat(W));
  L.push(pad('COD DESCRICAO', 22) + lpad('QTD UN', 8) + lpad('VL UNIT', 7) + lpad('VL ITEM', 7));
  r.items.forEach((it, idx) => {
    const q = it.un === 'KG' ? it.qty.toFixed(3).replace('.', ',') : String(it.qty);
    L.push(pad(String(idx + 1).padStart(3, '0') + ' ' + it.desc, 22) + lpad(`${q} ${it.un}`, 8) + lpad(money(it.unit), 7) + lpad(money(it.total), 7));
  });
  L.push('-'.repeat(W));
  L.push(pad('QTD. TOTAL DE ITENS', 30) + lpad(r.items.length, 14));
  L.push(pad('VALOR TOTAL R$', 30) + lpad(money(r.total), 14));
  L.push(pad('FORMA DE PAGAMENTO', 30) + lpad('VALOR PAGO', 14));
  L.push(pad('Cartao de Debito', 30) + lpad(money(r.total), 14));
  L.push('-'.repeat(W));
  L.push(`NFC-e n. ${r.nf} Serie 001 ${r.date} 14:32:10`);
  L.push('Consulte pela Chave de Acesso em');
  L.push('www.sefaz.sp.gov.br/nfce/consulta');
  L.push('CHAVE DE ACESSO');
  L.push(r.key.slice(0, 22).replace(/(\d{4})/g, '$1 ').trim());
  L.push(r.key.slice(22).replace(/(\d{4})/g, '$1 ').trim());
  L.push('CONSUMIDOR NAO IDENTIFICADO');
  return L;
}

async function render(r, outDir, name) {
  const lines = receiptLines(r);
  const fs_ = 22, lh = 30, pw = 660;
  const qrUrl = `https://www.sefaz.sp.gov.br/nfce/qrcode?p=${r.key}|2|1|1|ABCDEF0123456789`;
  const qrPng = await QRCode.toBuffer(qrUrl, { width: 260, margin: 2, errorCorrectionLevel: 'M' });
  const textH = lines.length * lh + 40;
  const h = textH + 300;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${h}"><rect width="100%" height="100%" fill="#fcfcfa"/>` +
    lines.map((l, i) => `<text x="24" y="${40 + i * lh}" font-family="DejaVu Sans Mono" font-size="${fs_}" fill="#1b1b1b" xml:space="preserve">${esc(l)}</text>`).join('') + '</svg>';
  const base = await sharp(Buffer.from(svg)).composite([{ input: qrPng, left: Math.round((pw - 260) / 2), top: textH + 10 }]).png().toBuffer();
  fs.writeFileSync(path.join(outDir, `${name}.clean.png`), base);
  return { base, qrUrl };
}

async function variants(base, outDir, name) {
  const v = {
    'clean-small': sharp(base).resize({ width: 480 }).png(),
    'rot3': sharp(base).rotate(3, { background: '#ffffff' }).png(),
    'rot8': sharp(base).rotate(8, { background: '#ffffff' }).png(),
    'blur': sharp(base).blur(1.4).png(),
    'lowcontrast': sharp(base).linear(0.55, 70).blur(0.8).png(),
    'jpeg-low': sharp(base).resize({ width: 560 }).jpeg({ quality: 35 }),
  };
  for (const [k, pipe] of Object.entries(v)) {
    const ext = k === 'jpeg-low' ? 'jpg' : 'png';
    fs.writeFileSync(path.join(outDir, `${name}.${k}.${ext}`), await pipe.toBuffer());
  }
}

(async () => {
  const outDir = path.join(__dirname, 'samples'); fs.mkdirSync(outDir, { recursive: true });
  const truth = [];
  for (let i = 0; i < 8; i++) {
    const r = makeReceipt(i); const name = `n${i + 1}`;
    const { base } = await render(r, outDir, name);
    await variants(base, outDir, name);
    truth.push({ name, ...r });
  }
  fs.writeFileSync(path.join(outDir, 'truth.json'), JSON.stringify(truth, null, 1));
  console.log('notas', truth.length, 'arquivos', fs.readdirSync(outDir).length);
})();
