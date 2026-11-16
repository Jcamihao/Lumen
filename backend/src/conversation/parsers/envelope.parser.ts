import { AmountFailure, parseAmountPrefix } from './amount.parser';

export type EnvelopeBodyResult =
  | { ok: true; name: string | null; monthlyCents: number | null }
  | { ok: false; reason: AmountFailure };

/** Só o valor inicial é dinheiro; números ao final permanecem parte do nome. */
export function parseEnvelopeBody(body: string): EnvelopeBodyResult {
  const text = body.trim();
  if (text === '') return { ok: true, name: null, monthlyCents: null };
  const parsed = parseAmountPrefix(text);
  if (parsed.ok === true) return { ok: true, name: parsed.rest || null, monthlyCents: parsed.cents };
  if (parsed.reason !== 'NOT_AMOUNT') return { ok: false, reason: parsed.reason };
  return { ok: true, name: text, monthlyCents: null };
}
