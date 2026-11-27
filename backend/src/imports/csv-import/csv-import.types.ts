import { TransactionType } from '@prisma/client';

export type ParsedRow = {
  type: TransactionType;
  description: string;
  amount: number;
  date: string;
  categoryName?: string;
  duplicate: boolean;
};
