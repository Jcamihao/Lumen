const MAX_MONEY_CENTS = 100000000; // R$ 1.000.000,00
const MONEY_PATTERN = /^(?:R\$\s*)?((?:\d{1,3}(?:\.\d{3})+)|\d+),(\d{2})$/;

/** Valor em centavos inteiros, ou null. Formato BR: milhar com ponto, decimal com exatamente 2 casas. */
export function moneyCents(raw: string): number | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const match = MONEY_PATTERN.exec(raw.trim());
  if (!match) return null;
  const intDigits = match[1].replace(/\./g, '');
  if (intDigits.length > 9) return null;
  const cents = Number(intDigits) * 100 + Number(match[2]);
  if (cents <= 0 || cents > MAX_MONEY_CENTS) return null;
  return cents;
}

export function parseBrMoney(raw: string): number | null {
  const cents = moneyCents(raw);
  return cents === null ? null : cents / 100;
}

export function parseBrQuantity(raw: string): number | null {
  const match = /^(\d{1,9})(?:,(\d{1,3}))?$/.exec(typeof raw === 'string' ? raw.trim() : '');
  if (!match) return null;
  const quantity = Number(`${match[1]}.${match[2] ?? '0'}`);
  return quantity > 0 ? quantity : null;
}
