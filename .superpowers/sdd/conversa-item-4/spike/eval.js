const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const jsQR = require('jsqr');
const { createWorker } = require('tesseract.js');

const dir = path.join(__dirname, 'samples');
const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
const money = (n) => n.toFixed(2).replace('.', ',');

function mod11ok(key) {
  if (!/^\d{44}$/.test(key)) return false;
  const body = key.slice(0, 43); let w = 2, s = 0;
  for (let i = body.length - 1; i >= 0; i--) { s += Number(body[i]) * w; w = w === 9 ? 2 : w + 1; }
  const r = s % 11; return (r < 2 ? 0 : 11 - r) === Number(key[43]);
}

async function decodeQr(buf) {
  const tries = [{ w: null }, { w: 900 }, { w: 1400 }, { w: 600 }];
  for (const t of tries) {
    let p = sharp(buf).flatten({ background: '#ffffff' });
    if (t.w) p = p.resize({ width: t.w });
    const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const res = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'attemptBoth' });
    if (res) return res.data;
  }
  return null;
}

function parseText(text) {
  const out = { total: null, date: null, cnpj: null, key: null, items: [] };
  const t = text.replace(/\r/g, '');
  const tot = t.match(/VALOR\s+TOTAL\s*R?\$?\s*([\d.]+,\d{2})/i);
  if (tot) out.total = tot[1];
  const d = t.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  if (d) out.date = d[1];
  const fix = (x) => x.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  const c = t.match(/([\dOoIlSB]{2}\.[\dOoIlSB]{3}\.[\dOoIlSB]{3}\/[\dOoIlSB]{4}-[\dOoIlSB]{2})/);
  if (c) out.cnpj = fix(c[1]).replace(/\D/g, '');
  const parts = t.split(/CHAVE\s+DE\s+ACESSO/i); const after = parts.length > 1 ? parts[parts.length - 1] : null;
  if (after) {
    const digits = fix(after.split('\n').slice(0, 3).join(' ').replace(/CONSUMIDOR.*/i, '')).replace(/[^\d]/g, '');
    out.key = digits.slice(0, 44);
  }
  for (const line of t.split('\n')) {
    const m = line.match(/^\s*(\d{3})\s+(.+?)\s+(\d+(?:,\d{3})?)\s*(UN|KG|Un|Kg|UM)\s+(\d+,\d{2})\s+(\d+,\d{2})\s*$/);
    if (m) out.items.push({ desc: m[2], qty: m[3], unit: m[5], total: m[6] });
  }
  return out;
}

const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function main() {
  const modes = process.argv.slice(2).length ? process.argv.slice(2) : ['raw', 'pre'];
  const langPath = path.join(__dirname, 'node_modules/@tesseract.js-data/por/4.0.0_best_int');
  const t0 = Date.now();
  const worker = await createWorker('por', 1, { langPath, gzip: true, cachePath: '/tmp/claude-1001/tess-cache' });
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  console.log('worker pronto em', Date.now() - t0, 'ms; rss MB', Math.round(process.memoryUsage().rss / 1e6));

  const files = fs.readdirSync(dir).filter((f) => /\.(png|jpg)$/.test(f)).sort();
  const results = [];
  for (const mode of modes) {
    for (const f of files) {
      const name = f.split('.')[0]; const variant = f.split('.')[1];
      const tr = truth.find((x) => x.name === name);
      const buf = fs.readFileSync(path.join(dir, f));
      const q0 = Date.now();
      const qr = await decodeQr(buf); const qrMs = Date.now() - q0;
      const qrKey = qr ? (qr.match(/p=(\d{44})/) || [])[1] || null : null;
      let img = buf;
      if (mode === 'pre') img = await sharp(buf).flatten({ background: '#ffffff' }).greyscale().normalise().resize({ width: 1400 }).sharpen().png().toBuffer();
      const o0 = Date.now();
      const { data } = await worker.recognize(img);
      const ocrMs = Date.now() - o0;
      const p = parseText(data.text);
      const itemsSum = p.items.reduce((a, b) => a + Number(b.total.replace(',', '.')), 0);
      const totalOk = p.total === money(tr.total);
      const flagged = p.items.length === 0 ? true : Math.abs(itemsSum - Number((p.total || '0').replace(',', '.'))) > 0.011;
      const itemsOk = tr.items.filter((it) => p.items.some((pi) => pi.total === money(it.total) && norm(pi.desc).slice(0, 8) === norm(it.desc).slice(0, 8))).length;
      results.push({
        mode, f, variant, qrOk: qrKey === tr.key, qrMs, ocrMs,
        totalOk, dateOk: p.date === tr.date, cnpjOk: p.cnpj === tr.cnpj, cnpjKey: (qrKey || (mod11ok(p.key||'') ? p.key : null) || '').slice(6, 20) === tr.cnpj,
        keyOk: p.key === tr.key, keyDv: mod11ok(p.key || ''),
        items: `${itemsOk}/${tr.items.length}`, itemsOk, nItems: tr.items.length,
        flagged, silentWrong: !totalOk && !flagged, conf: Math.round(data.confidence),
      });
    }
  }
  await worker.terminate();
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 1));
  for (const mode of modes) {
    console.log('\n== modo', mode);
    const variants = [...new Set(results.map((r) => r.variant))];
    for (const v of variants) {
      const rs = results.filter((r) => r.mode === mode && r.variant === v);
      const c = (k) => rs.filter((r) => r[k]).length;
      const itemsAll = rs.reduce((a, r) => a + r.nItems, 0); const itemsGot = rs.reduce((a, r) => a + r.itemsOk, 0);
      console.log(v.padEnd(12), `n=${rs.length}`, `QR ${c('qrOk')}/${rs.length}`, `total ${c('totalOk')}`, `data ${c('dateOk')}`, `cnpjOCR ${c('cnpjOk')}`, `cnpjViaChave ${c('cnpjKey')}`, `chaveOCR ${c('keyOk')}`, `itens ${itemsGot}/${itemsAll}`, `silenciosoErrado ${c('silentWrong')}`, `ocr ${Math.round(rs.reduce((a, r) => a + r.ocrMs, 0) / rs.length)}ms`, `qr ${Math.round(rs.reduce((a, r) => a + r.qrMs, 0) / rs.length)}ms`);
    }
    const all = results.filter((r) => r.mode === mode);
    console.log('TOTAL'.padEnd(12), `n=${all.length}`, `total ${all.filter((r) => r.totalOk).length}/${all.length}`, `silenciosoErrado ${all.filter((r) => r.silentWrong).length}`);
  }
  console.log('rss final MB', Math.round(process.memoryUsage().rss / 1e6));
}
main().catch((e) => { console.error(e); process.exit(1); });
