import { Prisma } from '@prisma/client';

type DecimalValue = Prisma.Decimal | null | undefined;

/** Valor monetario do banco como numero; ausente vira zero. */
export function toNumber(value: DecimalValue): number {
  return Number(value ?? 0);
}

/** Valor monetario opcional: ausente continua ausente (null). */
export function toNullableNumber(value: DecimalValue): number | null {
  return value === null || value === undefined ? null : Number(value);
}
