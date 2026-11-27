import { Prisma, TransactionType } from "@prisma/client";

export function signedAmount(type: TransactionType, amount: number) {
  return type === TransactionType.INCOME ? amount : -amount;
}

export function sumSignedAmounts(
  transactions: { type: TransactionType; amount: Prisma.Decimal }[],
) {
  return transactions.reduce(
    (total, transaction) => total + signedAmount(transaction.type, Number(transaction.amount)),
    0,
  );
}
