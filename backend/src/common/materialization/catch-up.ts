/**
 * Teto de vencimentos gerados por conta a cada rodada. Uma conta so acumula
 * varios vencimentos se ficou muito tempo sem ninguem abrir o app; o resto sai
 * na rodada seguinte, em vez de travar uma requisicao.
 */
export const MAX_CATCH_UP_PER_RUN = 24;

/** Ainda ha vencimento de hoje ou antes para gerar, e o teto da rodada nao estourou. */
export function isDueWithinRound(due: Date, today: Date, iterations: number) {
  return due <= today && iterations < MAX_CATCH_UP_PER_RUN;
}
