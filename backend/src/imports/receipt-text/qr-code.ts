import { normalizeAccessKey } from './access-key';

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
  const match = /\bp=(\d{44})(?!\d)/.exec(raw);
  return match ? normalizeAccessKey(match[1]) : null;
}
