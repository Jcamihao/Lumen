import { redactCpf } from './cpf-redaction';
import { moneyCents, parseBrQuantity } from './money';
import { RECEIPT_WARNINGS } from './receipt-warnings';
import { ReceiptTextItem } from './receipt-text.types';
import { MAX_LINE_CHARS } from './text-limits';

const MONEY_SRC = '(?:\\d{1,3}(?:\\.\\d{3})+|\\d+),\\d{2}';
const ITEM_LINE_RE = new RegExp(
  `^(?:\\d{1,14}\\s+)?(.+?)\\s+(\\d{1,9}(?:,\\d{1,3})?)\\s+([A-Za-z]{1,4})\\s+(?:[xX]\\s+)?(${MONEY_SRC})\\s+(${MONEY_SRC})$`,
);
const ITEM_SECOND_LINE_RE = new RegExp(
  `^(\\d{1,9}(?:,\\d{1,3})?)\\s+([A-Za-z]{1,4})\\s+[xX]\\s+(${MONEY_SRC})\\s+(${MONEY_SRC})$`,
);

export type ExtractedItems = {
  items: ReceiptTextItem[];
  itemCents: number[];
  itemLineIdx: Set<number>;
  itemWarnings: string[];
};

type RawItem = { description: string; quantity: string; unit: string; unitPrice: string; total: string };

function cleanDescription(raw: string): string {
  return redactCpf(raw.replace(/^\d{1,14}\s+/, '').replace(/\s+/g, ' ').trim()).slice(0, 200);
}

/** Quantidade em milesimos x unitario (centavos) contra total*1000: tolerancia de 1 centavo = 1000. */
function isLineConsistent(quantity: number, unitCents: number, totalCents: number): boolean {
  return Math.abs(Math.round(quantity * 1000) * unitCents - totalCents * 1000) <= 1000;
}

function buildItem(raw: RawItem): { item: ReceiptTextItem; cents: number } | null {
  const quantity = parseBrQuantity(raw.quantity);
  const unitCents = moneyCents(raw.unitPrice);
  const totalCents = moneyCents(raw.total);
  if (quantity === null || unitCents === null || totalCents === null) return null;
  const description = cleanDescription(raw.description);
  if ((description.match(/[A-Za-zÀ-ÿ]/g) ?? []).length < 2) return null;
  const unit = raw.unit.toUpperCase();
  const lineConsistent = isLineConsistent(quantity, unitCents, totalCents);
  const item = {
    description,
    quantity,
    unit: unit === 'X' ? null : unit,
    unitPrice: unitCents / 100,
    totalPrice: totalCents / 100,
    lineConsistent,
  };
  return { item, cents: totalCents };
}

function matchOneLine(line: string): RawItem | null {
  const m = ITEM_LINE_RE.exec(line);
  return m ? { description: m[1], quantity: m[2], unit: m[3], unitPrice: m[4], total: m[5] } : null;
}

function matchTwoLines(line: string, next: string | undefined): RawItem | null {
  if (!next || next.length > MAX_LINE_CHARS || /\d,\d{2}/.test(line)) return null;
  const m = ITEM_SECOND_LINE_RE.exec(next);
  return m ? { description: line, quantity: m[1], unit: m[2], unitPrice: m[3], total: m[4] } : null;
}

/** Itens nos formatos A (uma linha), B (uma linha com x) e C (duas linhas). */
export function extractItems(lines: string[]): ExtractedItems {
  const found: ExtractedItems = { items: [], itemCents: [], itemLineIdx: new Set(), itemWarnings: [] };
  const add = (raw: RawItem | null): boolean => {
    const built = raw ? buildItem(raw) : null;
    if (!built) return false;
    found.items.push(built.item);
    found.itemCents.push(built.cents);
    if (!built.item.lineConsistent) found.itemWarnings.push(RECEIPT_WARNINGS.W_ITEM_LINE(found.items.length));
    return true;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length > MAX_LINE_CHARS) continue;
    const one = matchOneLine(line);
    if (one) {
      if (add(one)) found.itemLineIdx.add(i);
      continue;
    }
    if (add(matchTwoLines(line, lines[i + 1]))) {
      found.itemLineIdx.add(i).add(i + 1);
      i++;
    }
  }
  return found;
}
