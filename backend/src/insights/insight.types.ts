import { InsightSeverity, InsightType } from '@prisma/client';

export type GeneratedInsight = {
  type: InsightType;
  severity: InsightSeverity;
  message: string;
  /**
   * Identifica a regra que gerou o insight. Regras agregadas usam so a chave;
   * detectores de cobranca somam um resumo do assunto, para que uma cobranca
   * nova gere identidade nova (e portanto uma notificacao nova).
   */
  key: string;
  metadata?: Record<string, unknown>;
};

export type ChargeOccurrence = {
  id: string;
  description: string;
  amount: number;
  date: Date;
};

export type ReceiptItemSnapshot = {
  description: string;
  totalPrice: number;
};

export type ReceiptScanSnapshot = {
  id: string;
  merchantName: string;
  purchaseDate: Date;
  totalAmount: number;
  items: ReceiptItemSnapshot[];
  tagGroupId: string;
  tagGroupName: string;
  /**
   * Escolha do usuario feita antes do upload: comparar esta nota com a
   * anterior do mesmo grupo. A comparacao e opcional — so acontece quando a
   * nota mais recente do par pediu.
   */
  compareWithPrevious: boolean;
};

export type CategoryTotal = {
  categoryId: string | null;
  name: string;
  total: number;
  count: number;
};
