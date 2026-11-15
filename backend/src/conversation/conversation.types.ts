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

export type PendingField = 'amount' | 'description' | 'category';

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
  /** Consultas do item 3a (contrato secao 4). Centavos; datas 'AAAA-MM-DD'. */
  dues?: Array<{ date: string; label: string; kind: 'FIXED' | 'INSTALLMENT'; amountCents: number }>;
  installments?: Array<{ label: string; number: number; total: number; amountCents: number; nextDate: string | null }>;
  fixedBills?: Array<{ label: string; frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY'; amountCents: number; nextDate: string }>;
  goals?: Array<{
    label: string;
    currentCents: number;
    targetCents: number | null;
    percent: number | null;
    targetDate: string | null;
  }>;
  /** Total a pagar (installments), total da janela (upcoming_dues), total mensal estimado (fixed_bills). */
  totalCents?: number;
}

export interface ConversationReply {
  kind: ConversationReplyKind;
  state: ConversationStateView;
  text: string;
  draft?: DraftView;
  data?: ReplyData;
  quickReplies?: string[];
  /**
   * true só quando o motor não reconheceu nenhuma intenção (texto livre). Permite ao canal
   * entregar a mensagem a outro destino (ex.: Selah). "ajuda", "confirmar" sem rascunho etc. não marcam.
   */
  unrecognized?: true;
}
