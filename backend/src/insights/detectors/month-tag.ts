/** "2026-6": identifica o mes civil (UTC) na chave do insight, para o aviso recomecar a cada mes. */
export function monthTagOf(now: Date): string {
  return `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`;
}
