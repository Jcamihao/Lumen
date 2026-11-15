import { ConversationChannel, ConversationState, PaymentMethod, TransactionType } from '@prisma/client';

export type { ConversationChannel };

/** Estado visivel: sem linha no banco = IDLE. */
export type ConversationStateView = ConversationState | 'IDLE';

export type ConversationReplyKind =
  | 'INFO'
  | 'ASK_FIELD'
  | 'CONFIRM_DRAFT'
  | 'DONE'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'HELP'
  | 'DUPLICATE'
  | 'ERROR';

/** Montado pelo adaptador do canal. userId vem so de JWT ou vinculo validado. */
export interface ConversationInput {
  userId: string;
  channel: ConversationChannel;
  messageId: string;
  text: string;
  receivedAt: Date;
}

/** Rascunho para a tela: valores formatados, sem ids internos alem de draftId/draftVersion. */
export interface DraftView {
  draftId: string;
  draftVersion: number;
  type: TransactionType;
  amount: string;
  description: string | null;
  category: string | null;
  date: string;
  paymentMethod: PaymentMethod | null;
  pendingField: PendingField | null;
}

export type PendingField = 'description' | 'category';

/** Rascunho guardado em ConversationSession.draft. Dinheiro sempre em centavos inteiros. */
export interface ExpenseOrIncomeDraft {
  type: TransactionType;
  amountCents: number;
  description: string | null;
  categoryId: string | null;
  date: string;
  paymentMethod: PaymentMethod | null;
  pendingField: PendingField | null;
  /** Ids de categoria oferecidos quando a escolha e ambigua (max 5). */
  categoryOptions: string[];
}

/** Dados numericos para a tela (centavos). Presentes em INFO e DONE. */
export interface ReplyData {
  balanceCents?: number;
  incomeCents?: number;
  expenseCents?: number;
  categories?: Array<{ name: string; amountCents: number }>;
  card?: {
    ceilingCents: number | null;
    spentCents: number;
    remainingCents: number | null;
    percentUsed: number | null;
    closingDay: number;
    dueDay: number | null;
  };
  transactionId?: string;
}

export interface ConversationReply {
  kind: ConversationReplyKind;
  state: ConversationStateView;
  text: string;
  draft?: DraftView;
  data?: ReplyData;
  quickReplies?: string[];
}
