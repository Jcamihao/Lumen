// Parser puro de texto de nota fiscal. Sem rede, sem banco, sem relogio global:
// a data de "hoje" entra por parametro. Datas sempre em Date.UTC (meia-noite UTC).

export type ReceiptTextItem = {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number;
  lineConsistent: boolean;
};

export type ReceiptTotalMismatch = { itemsSum: number; total: number; difference: number };

export type ParsedAccessKey = {
  key: string;
  ufCode: string;
  year: number;
  month: number;
  cnpj: string;
  model: string;
  series: string;
  number: string;
};

export type ParsedReceiptText = {
  merchantName: string | null;
  cnpj: string | null;
  cnpjSource: 'KEY' | 'TEXT' | null;
  accessKey: string | null;
  accessKeyValid: boolean;
  documentNumber: string | null;
  purchaseDate: Date | null;
  totalAmount: number | null;
  items: ReceiptTextItem[];
  itemsSum: number | null;
  totalMismatch: ReceiptTotalMismatch | null;
  warnings: string[];
  rawTextRedacted: string;
};

export const RECEIPT_WARNINGS = {
  W_KEY_CONFLICT: 'A chave do QR Code é diferente da chave impressa. Usei a do QR Code.',
  W_CNPJ_INVALID: 'O CNPJ lido não passou na conferência. Confira o estabelecimento.',
  W_DATE_INVALID: 'Não consegui ler a data da compra. Informe a data.',
  W_DATE_KEY_MISMATCH: 'O mês da data lida é diferente do mês da chave de acesso. Confira a data.',
  W_TOTAL_AMBIGUOUS: 'Encontrei mais de um valor total e nenhum bate com a soma dos itens. Confira o total.',
  W_TOTAL_MISMATCH: 'A soma dos itens é diferente do total da nota. Confira cada linha.',
  W_NO_ITEMS: 'Não consegui ler os itens da nota. Confira o total.',
  W_NO_TOTAL: 'Não consegui ler o total da nota.',
  W_ITEM_LINE: (n: number) => `Item ${n}: quantidade vezes preço não fecha com o valor da linha. Confira.`,
} as const;

type WarningKey = Exclude<keyof typeof RECEIPT_WARNINGS, 'W_ITEM_LINE'>;

// Ordem fixa dos avisos. Avisos de linha de item entram logo depois de W_TOTAL_MISMATCH.
const WARNING_ORDER: WarningKey[] = [
  'W_KEY_CONFLICT',
  'W_CNPJ_INVALID',
  'W_DATE_INVALID',
  'W_DATE_KEY_MISMATCH',
  'W_TOTAL_AMBIGUOUS',
  'W_TOTAL_MISMATCH',
  'W_NO_ITEMS',
  'W_NO_TOTAL',
];

const MAX_INPUT_CHARS = 200000;
const MAX_LINE_CHARS = 500;
const MAX_REDACTED_CHARS = 500;
const MAX_MONEY_CENTS = 100000000; // R$ 1.000.000,00

// Caracteres que o OCR confunde com digito (usado so em campos numericos).
const OCR_DIGIT = '[0-9OoIl|SB]';
const KEY_CANDIDATE_RE = new RegExp(
  `(?<!${OCR_DIGIT})${OCR_DIGIT}(?:[ \\t\\n]?${OCR_DIGIT}){43}(?!${OCR_DIGIT})`,
  'g',
);
const CNPJ_CANDIDATE_RE = new RegExp(
  `${OCR_DIGIT}{2}\\.${OCR_DIGIT}{3}\\.${OCR_DIGIT}{3}/${OCR_DIGIT}{4}-${OCR_DIGIT}{2}`,
  'g',
);
const DOC_NUMBER_RE = /\bNFC-?e\b[^\n\d]{0,10}(\d{1,9})(?!\d)|\bN[º°]\.?\s*[:.]?\s*(\d{1,9})(?!\d)/i;
const DATE_RE = /\b\d{2}\/\d{2}\/(?:\d{4}|\d{2})\b/;
const TIME_RE = /\b\d{1,2}:\d{2}\b/;
const TOTAL_LABEL_RE = /VALOR\s+TOTAL|TOTAL\s*R\$|VALOR\s+A\s+PAGAR|TOTAL\s+A\s+PAGAR|\bTOTAL\b/i;
const TOTAL_SKIP_RE = /QTD|ITENS|DESCONTO|TROCO|TRIBUTOS|SUBTOTAL/i;
const MONEY_IN_LINE_RE = /(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)/g;
const MERCHANT_SKIP_RE = /\b(CNPJ|CPF|NFC|DANFE|CUPOM|DOCUMENTO|CHAVE|CONSUMIDOR|EMITENTE|TOTAL|VALOR|ITEM|QTD|RUA|AVENIDA|ENDERECO|PRODUTO|CODIGO|DESCRICAO)\b|AV\./i;
const MONEY_SRC = '(?:\\d{1,3}(?:\\.\\d{3})+|\\d+),\\d{2}';
const ITEM_LINE_RE = new RegExp(
  `^(?:\\d{1,14}\\s+)?(.+?)\\s+(\\d{1,9}(?:,\\d{1,3})?)\\s+([A-Za-z]{1,4})\\s+(?:[xX]\\s+)?(${MONEY_SRC})\\s+(${MONEY_SRC})$`,
);
const ITEM_SECOND_LINE_RE = new RegExp(
  `^(\\d{1,9}(?:,\\d{1,3})?)\\s+([A-Za-z]{1,4})\\s+[xX]\\s+(${MONEY_SRC})\\s+(${MONEY_SRC})$`,
);

// ---------- Valores, quantidade e data ----------

/** Valor em centavos inteiros, ou null. Formato BR: milhar com ponto, decimal com exatamente 2 casas. */
function moneyCents(raw: string): number | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const m = /^(?:R\$\s*)?((?:\d{1,3}(?:\.\d{3})+)|\d+),(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const intDigits = m[1].replace(/\./g, '');
  if (intDigits.length > 9) return null;
  const cents = Number(intDigits) * 100 + Number(m[2]);
  if (cents <= 0 || cents > MAX_MONEY_CENTS) return null;
  return cents;
}

export function parseBrMoney(raw: string): number | null {
  const cents = moneyCents(raw);
  return cents === null ? null : cents / 100;
}

export function parseBrQuantity(raw: string): number | null {
  const m = /^(\d{1,9})(?:,(\d{1,3}))?$/.exec(typeof raw === 'string' ? raw.trim() : '');
  if (!m) return null;
  const quantity = Number(`${m[1]}.${m[2] ?? '0'}`);
  return quantity > 0 ? quantity : null;
}

export function parseBrDate(raw: string, today: Date): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}|\d{2})$/.exec(typeof raw === 'string' ? raw.trim() : '');
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (m[3].length === 2) year += 2000;
  if (year < 2000 || year > 2099) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rola 31/02 para 03/03: confere se o calendario bate.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (date.getTime() > todayUtc) return null;
  return date;
}

export function fixNumericOcr(raw: string): string {
  return (raw ?? '').replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
}

// ---------- Chave de acesso e CNPJ ----------

function mod11Dv(body: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidAccessKeyDv(key: string): boolean {
  if (typeof key !== 'string' || !/^\d{44}$/.test(key)) return false;
  // 44 digitos iguais "fecham" o DV por acaso: recusa.
  if (/^(\d)\1{43}$/.test(key)) return false;
  return mod11Dv(key.slice(0, 43)) === Number(key[43]);
}

export function normalizeAccessKey(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  const key = fixNumericOcr(raw.replace(/\s+/g, ''));
  return isValidAccessKeyDv(key) ? key : null;
}

export function decodeAccessKey(key: string): ParsedAccessKey | null {
  if (!isValidAccessKeyDv(key)) return null;
  const month = Number(key.slice(4, 6));
  if (month < 1 || month > 12) return null;
  return {
    key,
    ufCode: key.slice(0, 2),
    year: 2000 + Number(key.slice(2, 4)),
    month,
    cnpj: key.slice(6, 20),
    model: key.slice(20, 22),
    series: key.slice(22, 25),
    number: key.slice(25, 34),
  };
}

function cnpjDv(body: string, weights: number[]): number {
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCnpj(cnpj: string): boolean {
  if (typeof cnpj !== 'string' || !/^\d{14}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const dv1 = cnpjDv(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = cnpjDv(cnpj.slice(0, 12) + dv1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(cnpj[12]) && dv2 === Number(cnpj[13]);
}

// ---------- Privacidade ----------

export function redactCpf(text: string): string {
  if (typeof text !== 'string') return '';
  // Uma passada so: "CPF" + ate 30 caracteres da mesma linha. Depois, CPF com pontuacao solto.
  return text
    .replace(/\bCPF\b[^\n]{0,30}/gi, 'CPF removido')
    .replace(/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, 'CPF removido');
}

// ---------- QR Code ----------

export function sanitizeQrUrl(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const base = `${url.protocol}//${url.host}${url.pathname}`;
  const p = url.searchParams.get('p') ?? '';
  const key = /^(\d{44})(?!\d)/.exec(p);
  return key ? `${base}?p=${key[1]}` : base;
}

export function extractAccessKeyFromQr(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  const m = /\bp=(\d{44})(?!\d)/.exec(raw);
  return m ? normalizeAccessKey(m[1]) : null;
}

// ---------- Parser principal ----------

function emptyResult(): ParsedReceiptText {
  return {
    merchantName: null,
    cnpj: null,
    cnpjSource: null,
    accessKey: null,
    accessKeyValid: false,
    documentNumber: null,
    purchaseDate: null,
    totalAmount: null,
    items: [],
    itemsSum: null,
    totalMismatch: null,
    warnings: [RECEIPT_WARNINGS.W_DATE_INVALID, RECEIPT_WARNINGS.W_NO_ITEMS, RECEIPT_WARNINGS.W_NO_TOTAL],
    rawTextRedacted: '',
  };
}

/** Chave usavel: DV valido e mes valido. */
function usableKey(key: string | null): string | null {
  return key && decodeAccessKey(key) ? key : null;
}

function firstValidKeyIn(s: string): string | null {
  for (const m of s.matchAll(KEY_CANDIDATE_RE)) {
    const key = usableKey(normalizeAccessKey(m[0]));
    if (key) return key;
  }
  return null;
}

function findTextKey(lines: string[]): string | null {
  // A ultima ocorrencia do rotulo vale (a nota pode repetir o cabecalho).
  let labelIdx = -1;
  lines.forEach((line, i) => {
    if (/CHAVE\s+DE\s+ACESSO/i.test(line)) labelIdx = i;
  });
  if (labelIdx >= 0) {
    const chunk = lines
      .slice(labelIdx, labelIdx + 4)
      .map((line, i) => (i === 0 ? line.replace(/^.*CHAVE\s+DE\s+ACESSO/i, '') : line).replace(/CONSUMIDOR.*$/i, ''))
      .join('\n');
    const key = firstValidKeyIn(chunk);
    if (key) return key;
  }
  return firstValidKeyIn(lines.join('\n'));
}

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

function isMerchantLine(line: string): boolean {
  return (
    line.length >= 4 &&
    line.length <= 120 &&
    /^[A-Za-zÀ-ÿ0-9 .&'-]+$/.test(line) &&
    (line.match(/[A-Za-zÀ-ÿ]/g) ?? []).length >= 4 &&
    !MERCHANT_SKIP_RE.test(line)
  );
}

function finishWarnings(flags: Set<WarningKey>, itemWarnings: string[]): string[] {
  const split = WARNING_ORDER.indexOf('W_TOTAL_MISMATCH') + 1;
  const before = WARNING_ORDER.slice(0, split).filter((k) => flags.has(k)).map((k) => RECEIPT_WARNINGS[k]);
  const after = WARNING_ORDER.slice(split).filter((k) => flags.has(k)).map((k) => RECEIPT_WARNINGS[k]);
  return [...before, ...itemWarnings, ...after];
}

function parseUnsafe(text: string, options: { today: Date; qrAccessKey?: string | null }): ParsedReceiptText {
  const flags = new Set<WarningKey>();
  const itemWarnings: string[] = [];
  const today = options.today;

  const source = (typeof text === 'string' ? text.slice(0, MAX_INPUT_CHARS) : '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  const lines = source.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim());

  // Chave: QR vence o texto; so vale com DV e mes validos.
  const textKey = findTextKey(lines);
  const qrKey = options.qrAccessKey ? usableKey(normalizeAccessKey(options.qrAccessKey)) : null;
  const accessKey = qrKey ?? textKey;
  if (qrKey && textKey && qrKey !== textKey) flags.add('W_KEY_CONFLICT');
  const decoded = accessKey ? decodeAccessKey(accessKey) : null;

  // CNPJ: da chave; senao do texto (com recuperacao de OCR no trecho).
  let cnpj: string | null = null;
  let cnpjSource: 'KEY' | 'TEXT' | null = null;
  if (decoded) {
    cnpj = decoded.cnpj;
    cnpjSource = 'KEY';
  } else {
    const candidates = [...source.matchAll(CNPJ_CANDIDATE_RE)].map((m) => m[0]);
    if (candidates.length > 0) {
      const valid = candidates.map((c) => fixNumericOcr(c).replace(/\D/g, '')).find((c) => isValidCnpj(c));
      if (valid) {
        cnpj = valid;
        cnpjSource = 'TEXT';
      } else {
        flags.add('W_CNPJ_INVALID');
      }
    }
  }

  // Numero do documento.
  let documentNumber: string | null = null;
  if (decoded) {
    documentNumber = stripLeadingZeros(decoded.number);
  } else {
    const m = DOC_NUMBER_RE.exec(source);
    if (m) documentNumber = stripLeadingZeros(m[1] ?? m[2]);
  }

  // Data: primeira linha com data e horario; senao a primeira data do texto.
  let dateRaw: string | null = null;
  for (const line of lines) {
    const m = DATE_RE.exec(line);
    if (m && TIME_RE.test(line)) {
      dateRaw = m[0];
      break;
    }
  }
  if (!dateRaw) {
    for (const line of lines) {
      const m = DATE_RE.exec(line);
      if (m) {
        dateRaw = m[0];
        break;
      }
    }
  }
  const purchaseDate = dateRaw ? parseBrDate(dateRaw, today) : null;
  if (!purchaseDate) flags.add('W_DATE_INVALID');
  if (purchaseDate && decoded && (purchaseDate.getUTCFullYear() !== decoded.year || purchaseDate.getUTCMonth() + 1 !== decoded.month)) {
    flags.add('W_DATE_KEY_MISMATCH');
  }

  // Itens: formatos A (uma linha), B (uma linha com x) e C (duas linhas).
  const items: ReceiptTextItem[] = [];
  const itemCents: number[] = [];
  const addItem = (rawDescription: string, qRaw: string, unitRaw: string, unitPriceRaw: string, totalRaw: string): void => {
    const quantity = parseBrQuantity(qRaw);
    const unitCents = moneyCents(unitPriceRaw);
    const totalC = moneyCents(totalRaw);
    if (quantity === null || unitCents === null || totalC === null) return;
    const description = redactCpf(rawDescription.replace(/^\d{1,14}\s+/, '').replace(/\s+/g, ' ').trim()).slice(0, 200);
    if ((description.match(/[A-Za-zÀ-ÿ]/g) ?? []).length < 2) return;
    // Quantidade em milesimos x unitario (centavos) contra total*1000: tolerancia de 1 centavo = 1000.
    const consistent = Math.abs(Math.round(quantity * 1000) * unitCents - totalC * 1000) <= 1000;
    const unit = unitRaw.toUpperCase();
    items.push({
      description,
      quantity,
      unit: unit === 'X' ? null : unit,
      unitPrice: unitCents / 100,
      totalPrice: totalC / 100,
      lineConsistent: consistent,
    });
    itemCents.push(totalC);
    if (!consistent) itemWarnings.push(RECEIPT_WARNINGS.W_ITEM_LINE(items.length));
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length > MAX_LINE_CHARS) continue;
    const one = ITEM_LINE_RE.exec(line);
    if (one) {
      addItem(one[1], one[2], one[3], one[4], one[5]);
      continue;
    }
    const next = lines[i + 1];
    if (next && next.length <= MAX_LINE_CHARS && !/\d,\d{2}/.test(line)) {
      const two = ITEM_SECOND_LINE_RE.exec(next);
      if (two) {
        addItem(line, two[1], two[2], two[3], two[4]);
        i++;
      }
    }
  }

  // Total: candidatos rotulados, sem linhas de quantidade, desconto, troco etc.
  const candidates = new Set<number>();
  for (const line of lines) {
    if (!TOTAL_LABEL_RE.test(line) || TOTAL_SKIP_RE.test(line)) continue;
    let last: number | null = null;
    for (const m of line.matchAll(MONEY_IN_LINE_RE)) {
      const cents = moneyCents(m[0]);
      if (cents !== null) last = cents;
    }
    if (last !== null) candidates.add(last);
  }
  const totalOptions = [...candidates];
  const itemsSumCents = itemCents.length > 0 ? itemCents.reduce((a, b) => a + b, 0) : null;
  let totalCents: number | null = null;
  if (totalOptions.length === 1) {
    totalCents = totalOptions[0];
  } else if (totalOptions.length > 1) {
    const equal = itemsSumCents === null ? undefined : totalOptions.find((c) => c === itemsSumCents);
    if (equal !== undefined) {
      totalCents = equal;
    } else {
      totalCents = totalOptions.reduce((a, b) => Math.max(a, b), 0);
      flags.add('W_TOTAL_AMBIGUOUS');
    }
  }

  // Soma: divergencia so acima de 1 centavo.
  let totalMismatch: ReceiptTotalMismatch | null = null;
  if (totalCents !== null && itemsSumCents !== null && Math.abs(totalCents - itemsSumCents) > 1) {
    totalMismatch = {
      itemsSum: itemsSumCents / 100,
      total: totalCents / 100,
      difference: (totalCents - itemsSumCents) / 100,
    };
    flags.add('W_TOTAL_MISMATCH');
  }
  if (items.length === 0) flags.add('W_NO_ITEMS');
  if (totalCents === null) flags.add('W_NO_TOTAL');

  // Estabelecimento: primeira linha de cabecalho com cara de nome (heuristica).
  const merchantLine = lines.slice(0, 15).find(isMerchantLine);
  const merchantName = merchantLine ? redactCpf(merchantLine) : null;

  // Texto guardado: sem CPF, linhas vazias repetidas colapsadas, ate 500 caracteres.
  const collapsed: string[] = [];
  for (const line of redactCpf(source).split('\n').map((l) => l.trimEnd())) {
    if (line === '' && (collapsed.length === 0 || collapsed[collapsed.length - 1] === '')) continue;
    collapsed.push(line);
  }
  const rawTextRedacted = collapsed.join('\n').slice(0, MAX_REDACTED_CHARS);

  return {
    merchantName,
    cnpj,
    cnpjSource,
    accessKey,
    accessKeyValid: accessKey !== null,
    documentNumber,
    purchaseDate,
    totalAmount: totalCents === null ? null : totalCents / 100,
    items,
    itemsSum: itemsSumCents === null ? null : itemsSumCents / 100,
    totalMismatch,
    warnings: finishWarnings(flags, itemWarnings),
    rawTextRedacted,
  };
}

/** Nunca lanca por texto estranho: qualquer falha vira resultado vazio com avisos. */
export function parseReceiptText(
  text: string,
  options: { today: Date; qrAccessKey?: string | null },
): ParsedReceiptText {
  try {
    return parseUnsafe(text, options);
  } catch {
    return emptyResult();
  }
}
