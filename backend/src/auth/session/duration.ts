const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Converte duracoes como "15m", "12h" ou "7d" em milissegundos. */
export function parseDurationToMs(value: string): number {
  const match = value.trim().toLowerCase().match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    throw new Error(`Duracao JWT invalida: "${value}". Use formatos como 15m, 12h ou 7d.`);
  }
  return Number(match[1]) * UNIT_TO_MS[match[2]];
}
