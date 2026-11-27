export function normalizeText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function optionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

export function toDateOrNull(value?: string | null): Date | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const brDateMatch = normalized.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
  if (brDateMatch) {
    const [, day, month, year] = brDateMatch;
    const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
