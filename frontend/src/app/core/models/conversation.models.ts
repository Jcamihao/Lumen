// Copiados de backend/src/conversation/conversation.types.ts (contrato do item 1).
// Manter em sincronia manualmente: o front não importa do backend.

export type ConversationState =
  | 'COLLECTING_FIELDS'
  | 'AWAITING_CONFIRMATION'
  | 'AWAITING_IMPORT_FILE'
  | 'AWAITING_IMPORT_REVIEW'
  | 'PROCESSING';

/** Estado visível: sem sessão no banco = IDLE. */
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

export type ConversationTransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

export type ConversationPaymentMethod = 'PIX' | 'CREDIT' | 'DEBIT';

export type PendingField = 'description' | 'category';

/** Rascunho para a tela: valores formatados, sem ids internos além de draftId/draftVersion. */
export interface DraftView {
  draftId: string;
  draftVersion: number;
  type: ConversationTransactionType;
  amount: string;
  description: string | null;
  category: string | null;
  date: string;
  paymentMethod: ConversationPaymentMethod | null;
  pendingField: PendingField | null;
}

/** Dados numéricos para a tela (centavos). Presentes em INFO e DONE. */
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
  /** true só quando o motor não reconheceu a intenção (texto livre). Só esse caso vai ao Selah. */
  unrecognized?: true;
}

/** Resposta de GET /conversation/session. */
export interface ConversationSessionView {
  state: ConversationStateView;
  draft?: DraftView;
}
