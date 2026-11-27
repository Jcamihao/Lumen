import { ParsedAccessKey } from './receipt-text.types';

const DATE_RE = /\b\d{2}\/\d{2}\/(?:\d{4}|\d{2})\b/;
const TIME_RE = /\b\d{1,2}:\d{2}\b/;

function isValidToday(today: Date): boolean {
  return today instanceof Date && !Number.isNaN(today.getTime());
}

function calendarMatches(date: Date, year: number, month: number, day: number): boolean {
  // Date.UTC rola 31/02 para 03/03: confere se o calendario bate.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseBrDate(raw: string, today: Date): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}|\d{2})$/.exec(typeof raw === 'string' ? raw.trim() : '');
  if (!match) return null;
  // "Hoje" invalido (NaN) faria qualquer data parecer valida: recusa.
  if (!isValidToday(today)) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3].length === 2 ? Number(match[3]) + 2000 : Number(match[3]);
  if (year < 2000 || year > 2099) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!calendarMatches(date, year, month, day)) return null;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return date.getTime() > todayUtc ? null : date;
}

/** Primeira linha com data e horario; senao a primeira data do texto. */
export function findDateText(lines: string[]): string | null {
  for (const line of lines) {
    const match = DATE_RE.exec(line);
    if (match && TIME_RE.test(line)) return match[0];
  }
  for (const line of lines) {
    const match = DATE_RE.exec(line);
    if (match) return match[0];
  }
  return null;
}

export function dateDiffersFromKey(date: Date, key: ParsedAccessKey): boolean {
  return date.getUTCFullYear() !== key.year || date.getUTCMonth() + 1 !== key.month;
}
