import { BadRequestException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { looksLikeText, sniffMime } from '../../common/utils/file-sniff';
import { CSV_IMPORT_MAX_BYTES, CSV_IMPORT_MAX_ROWS } from '../imports.constants';

export type RawCsvRow = {
  type: TransactionType;
  description: string;
  amount: number;
  date: string;
  categoryName?: string;
};

const TYPE_ALIASES: Record<string, TransactionType> = {
  INCOME: TransactionType.INCOME,
  RECEITA: TransactionType.INCOME,
  EXPENSE: TransactionType.EXPENSE,
  DESPESA: TransactionType.EXPENSE,
  TRANSFER: TransactionType.TRANSFER,
  TRANSFERENCIA: TransactionType.TRANSFER,
};

export function normalizeType(value?: string): TransactionType | null {
  const normalized = value?.trim().toUpperCase();
  return normalized ? (TYPE_ALIASES[normalized] ?? null) : null;
}

function ensureCsvFile(file?: Express.Multer.File): asserts file is Express.Multer.File {
  if (!file) throw new BadRequestException('Envie um arquivo CSV no campo file.');
  if (file.size > CSV_IMPORT_MAX_BYTES) throw new BadRequestException('O arquivo CSV deve ter no maximo 5 MB.');
  if (!looksLikeText(file.buffer) || sniffMime(file.buffer) !== null) {
    throw new BadRequestException('O arquivo enviado nao parece um CSV de texto.');
  }
}

function readRecords(buffer: Buffer): Record<string, string>[] {
  let rows: Record<string, string>[];
  try {
    // `to` interrompe a leitura logo depois do teto: arquivo enorme nao gasta CPU.
    rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true, to: CSV_IMPORT_MAX_ROWS + 1 });
  } catch {
    throw new BadRequestException('Nao foi possivel ler o CSV. Confira se o arquivo esta no formato correto.');
  }
  if (rows.length > CSV_IMPORT_MAX_ROWS) {
    throw new BadRequestException(`O CSV pode ter no maximo ${CSV_IMPORT_MAX_ROWS} linhas por importacao.`);
  }
  if (rows.length === 0) throw new BadRequestException('O arquivo CSV esta vazio.');
  return rows;
}

const lowerCaseKeys = (row: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value]));

function toRawRow(row: Record<string, string>): RawCsvRow {
  const type = normalizeType(row.type ?? row.tipo);
  const description = row.description ?? row.descricao;
  const amount = Number(String(row.amount ?? row.valor ?? '0').replace(',', '.'));
  const date = row.date ?? row.data;
  if (!type || !description || Number.isNaN(amount) || !date) {
    throw new BadRequestException('Cada linha do CSV precisa ter tipo, descricao, valor e data.');
  }
  return { type, description, amount, date, categoryName: row.category ?? row.categoria };
}

/** Valida o arquivo e devolve as linhas do CSV ja normalizadas. */
export function parseTransactionsCsv(file?: Express.Multer.File): RawCsvRow[] {
  ensureCsvFile(file);
  return readRecords(file.buffer).map(lowerCaseKeys).map(toRawRow);
}
