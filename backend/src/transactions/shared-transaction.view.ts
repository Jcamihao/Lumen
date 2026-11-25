import { Prisma, PaymentMethod, TransactionType } from '@prisma/client';
import { isSharedItem, partnerSharingFlags, withoutSharingMark } from '../access-scope/shared-view';

interface PartnerReadableTransaction {
  id: string;
  type: TransactionType;
  description: string;
  amount: { toString(): string } | number;
  date: Date;
  paymentMethod: PaymentMethod | null;
  category: { name: string; color: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lancamento de outro membro, como o parceiro pode ve-lo: so o que e necessario para ler e editar.
 * Sem userId, sem id de categoria privada do autor (so nome e cor), sem envelope nem cartao do autor.
 */
export function toPartnerTransactionView(transaction: PartnerReadableTransaction, authorFirstName: string | null) {
  return {
    id: transaction.id,
    type: transaction.type,
    description: transaction.description,
    amount: Number(transaction.amount),
    date: transaction.date,
    paymentMethod: transaction.paymentMethod,
    category: transaction.category ? { name: transaction.category.name, color: transaction.category.color } : null,
    cardName: null,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    ...partnerSharingFlags(authorFirstName),
  };
}

type TransactionWithCategory = Prisma.TransactionGetPayload<{ include: { category: true } }>;

/** Exportacao LGPD (contrato 11b, item 7): o dono ve o proprio lancamento e se ele estava compartilhado. */
export function toPrivacyTransactionExport(transaction: TransactionWithCategory) {
  const { category, amount, ...rest } = transaction;
  return {
    ...withoutSharingMark(rest),
    amount: Number(amount),
    category: category ? withoutSharingMark(category) : null,
    shared: isSharedItem(transaction),
  };
}
