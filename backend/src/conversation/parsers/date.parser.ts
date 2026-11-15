export type DateToken =
  | { kind: 'DATE'; ymd: string }
  | { kind: 'INVALID' };

export interface ExtractedDate {
  ymd: string;
  rest: string[];
  invalid: boolean;
}

/** Soma dias a uma data 'YYYY-MM-DD' sem depender do fuso do servidor. */
export function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Procura a primeira palavra de data (hoje, ontem, anteontem, dd/mm, dd/mm/aaaa)
 * entre os tokens. Sem data: usa hoje. Data inexistente (ex.: 31/02): invalid.
 */
export function extractDate(tokens: string[], todayYmd: string): ExtractedDate {
  const index = tokens.findIndex((token) => parseDateToken(token, todayYmd) !== null);
  if (index === -1) {
    return { ymd: todayYmd, rest: tokens, invalid: false };
  }

  const parsed = parseDateToken(tokens[index], todayYmd);
  const rest = tokens.filter((_, position) => position !== index);
  if (parsed === null || parsed.kind === 'INVALID') {
    return { ymd: todayYmd, rest, invalid: true };
  }
  return { ymd: parsed.ymd, rest, invalid: false };
}

export function parseDateToken(token: string, todayYmd: string): DateToken | null {
  const word = token
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[?!.,;:]+$/g, '');

  if (word === 'hoje') return { kind: 'DATE', ymd: todayYmd };
  if (word === 'ontem') return { kind: 'DATE', ymd: addDaysYmd(todayYmd, -1) };
  if (word === 'anteontem') return { kind: 'DATE', ymd: addDaysYmd(todayYmd, -2) };

  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(word);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3] ? Number(match[3]) : Number(todayYmd.slice(0, 4));
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!valid) {
    return { kind: 'INVALID' };
  }
  return { kind: 'DATE', ymd: date.toISOString().slice(0, 10) };
}
