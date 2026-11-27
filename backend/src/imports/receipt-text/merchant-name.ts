import { redactCpf } from './cpf-redaction';

const MERCHANT_SKIP_RE =
  /\b(CNPJ|CPF|NFC|DANFE|CUPOM|DOCUMENTO|CHAVE|CONSUMIDOR|EMITENTE|TOTAL|VALOR|ITEM|QTD|RUA|AVENIDA|ENDERECO|PRODUTO|CODIGO|DESCRICAO)\b|AV\./i;
const HEADER_LINES = 15;

function isMerchantLine(line: string): boolean {
  return (
    line.length >= 4 &&
    line.length <= 120 &&
    /^[A-Za-zÀ-ÿ0-9 .&'-]+$/.test(line) &&
    (line.match(/[A-Za-zÀ-ÿ]/g) ?? []).length >= 4 &&
    !MERCHANT_SKIP_RE.test(line)
  );
}

/** Primeira linha de cabecalho com cara de nome (heuristica). */
export function findMerchantName(lines: string[]): string | null {
  const line = lines.slice(0, HEADER_LINES).find(isMerchantLine);
  return line ? redactCpf(line) : null;
}
