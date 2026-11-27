/**
 * Janela de leitura das despesas usada pelos detectores de cobranca.
 * 120 dias cobrem 4 ciclos mensais, o minimo para enxergar uma assinatura
 * com tres ocorrencias e ainda sobrar folga.
 */
export const CHARGE_WINDOW_DAYS = 120;
export const CHARGE_WINDOW_MAX_ROWS = 500;

/** Quantas notas fiscais importadas olhar pra tras ao procurar pares pra comparar. */
export const RECEIPT_SCAN_MAX_ROWS = 200;

// Conta fixa que vence nos proximos dias: avisa com antecedencia (amanha vira
// WARNING). No dia do vencimento o lancamento ja foi gerado e o aviso some.
export const UPCOMING_BILL_WINDOW_DAYS = 3;
