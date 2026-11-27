export const RECEIPT_WARNINGS = {
  W_KEY_CONFLICT: 'A chave do QR Code é diferente da chave impressa. Usei a do QR Code.',
  W_CNPJ_INVALID: 'O CNPJ lido não passou na conferência. Confira o estabelecimento.',
  W_DATE_INVALID: 'Não consegui ler a data da compra. Informe a data.',
  W_DATE_KEY_MISMATCH: 'O mês da data lida é diferente do mês da chave de acesso. Confira a data.',
  W_TOTAL_AMBIGUOUS: 'Encontrei mais de um valor total e nenhum bate com a soma dos itens. Confira o total.',
  W_TOTAL_MULTIPLE:
    'Encontrei mais de um valor total na nota (por exemplo, valor bruto e valor a pagar). Confira quanto você pagou.',
  W_TOTAL_MISMATCH: 'A soma dos itens é diferente do total da nota. Confira cada linha.',
  W_NO_ITEMS: 'Não consegui ler os itens da nota. Confira o total.',
  W_NO_TOTAL: 'Não consegui ler o total da nota.',
  W_ITEM_LINE: (n: number) => `Item ${n}: quantidade vezes preço não fecha com o valor da linha. Confira.`,
} as const;

export type WarningKey = Exclude<keyof typeof RECEIPT_WARNINGS, 'W_ITEM_LINE'>;

// Ordem fixa dos avisos. Avisos de linha de item entram logo depois de W_TOTAL_MISMATCH.
const WARNING_ORDER: WarningKey[] = [
  'W_KEY_CONFLICT',
  'W_CNPJ_INVALID',
  'W_DATE_INVALID',
  'W_DATE_KEY_MISMATCH',
  'W_TOTAL_AMBIGUOUS',
  'W_TOTAL_MULTIPLE',
  'W_TOTAL_MISMATCH',
  'W_NO_ITEMS',
  'W_NO_TOTAL',
];

const messagesFor = (keys: WarningKey[], flags: Set<WarningKey>): string[] =>
  keys.filter((key) => flags.has(key)).map((key) => RECEIPT_WARNINGS[key]);

/** Junta os avisos na ordem fixa, com os avisos de linha de item depois de W_TOTAL_MISMATCH. */
export function orderWarnings(flags: Set<WarningKey>, itemWarnings: string[]): string[] {
  const split = WARNING_ORDER.indexOf('W_TOTAL_MISMATCH') + 1;
  const before = messagesFor(WARNING_ORDER.slice(0, split), flags);
  const after = messagesFor(WARNING_ORDER.slice(split), flags);
  return [...before, ...itemWarnings, ...after];
}
