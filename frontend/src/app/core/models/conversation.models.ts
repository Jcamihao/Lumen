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

export type DraftKind = 'TRANSACTION' | 'GOAL' | 'CONTRIBUTION' | 'ENVELOPE' | 'CREDIT_LIMIT' | 'RECURRING' | 'INSTALLMENT';

export type PendingField =
  | 'amount'
  | 'description'
  | 'category'
  | 'title'
  | 'target'
  | 'goal'
  | 'name'
  | 'installmentsTotal'
  | 'firstDueDate';

/** Linha do cartão do rascunho, já formatada pelo backend. Valor ausente vem como "a informar". */
export interface DraftRow {
  label: string;
  value: string;
}

/** Rascunho para a tela: valores formatados, sem ids internos além de draftId/draftVersion. */
export interface DraftView {
  draftId: string;
  draftVersion: number;
  /** Sessão antiga sem kind chega como 'TRANSACTION'. */
  kind: DraftKind;
  /** 'Lançamento' | 'Meta' | 'Aporte'. */
  title: string;
  rows: DraftRow[];
  type: ConversationTransactionType;
  /** Nulo em meta e aporte (sem uso). */
  amount: string | null;
  description: string | null;
  category: string | null;
  /** 'AAAA-MM-DD'. Nulo em meta e aporte. Para exibir, use `rows`. */
  date: string | null;
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
  /** Em DONE de reserva: id do envelope criado. */
  envelopeId?: string;
  /** Em DONE de conta fixa criada: id da regra. */
  recurringTransactionId?: string;
  /** Em DONE de compra parcelada criada: id da compra. */
  installmentPurchaseId?: string;
  /** Tela que a resposta sugere abrir ("importar nota" → 'imports'). */
  screen?: 'imports';
  /** Em `envelopes`: total disponível das reservas ativas. */
  totalCents?: number;
  goalId?: string;
  envelopes?: Array<{ label: string; monthlyCents: number; availableCents: number; spentCents: number }>;
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
