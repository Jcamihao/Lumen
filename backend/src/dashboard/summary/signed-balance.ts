import { TransactionType } from '@prisma/client';
import { toNumber } from './number';
import { SummarySources } from './summary-sources.type';

type BalanceRow = SummarySources['balanceRows'][number];

const signedAmount = (row: BalanceRow) =>
  row.type === TransactionType.INCOME ? toNumber(row._sum.amount) : -toNumber(row._sum.amount);

/** Saldo: entradas somam, saidas subtraem. */
export function signedBalance(rows: BalanceRow[]): number {
  return rows.reduce((total, row) => total + signedAmount(row), 0);
}
