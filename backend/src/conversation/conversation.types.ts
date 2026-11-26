import { ConversationChannel, ConversationState, PaymentMethod, TransactionType } from '@prisma/client';
import type { MenuView } from './menu/menu.types';

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
  | 'MENU'
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

export type DraftKind =
  | 'TRANSACTION'
  | 'GOAL'
  | 'CONTRIBUTION'
  | 'ENVELOPE'
  | 'CREDIT_LIMIT'
  | 'RECURRING'
  | 'INSTALLMENT'
  | 'TRANSACTION_CHANGE'
  | 'GOAL_CHANGE'
  | 'ENVELOPE_CHANGE'
  | 'RECURRING_CHANGE'
  | 'INSTALLMENT_CHANGE'
  | 'CARD_RENAME'
  | 'CARD_CREATE'
  | 'CATEGORY_CREATE'
  | 'CATEGORY_CHANGE';

/**
 * Rascunho para a tela: valores formatados, sem ids internos alem de draftId/draftVersion.
 * Para meta e aporte, type fica 'EXPENSE' e os campos de lançamento vêm nulos (sem uso); a tela lê `rows`.
 */
export interface DraftView {
  draftId: string;
  draftVersion: number;
  kind: DraftKind;
  /** "Lançamento", "Meta" ou "Aporte". */
  title: string;
  /** Linhas já formatadas, sem valor nulo ("a informar" quando falta). */
  rows: Array<{ label: string; value: string }>;
  type: TransactionType;
  amount: string | null;
  description: string | null;
  category: string | null;
  date: string | null;
  paymentMethod: PaymentMethod | null;
  pendingField: PendingField | null;
  /** Nos rascunhos de mudar (TRANSACTION_CHANGE, GOAL_CHANGE, ENVELOPE_CHANGE): a tela escolhe o cartão de apagar pelo valor. */
  changeAction?: 'EDIT' | 'DELETE' | 'CLEAR';
}

export type PendingField =
  | 'card'
  | 'amount'
  | 'description'
  | 'category'
  | 'title'
  | 'target'
  | 'goal'
  | 'name'
  | 'installmentsTotal'
  | 'firstDueDate'
  | 'transaction'
  | 'targetChoice'
  | 'change'
  | 'closingDay';

/** Rascunho de lançamento. Sessões antigas não têm `kind`: ausente = TRANSACTION. Dinheiro em centavos. */
export interface ExpenseOrIncomeDraft {
  /** messageId de quem abriu o rascunho: semente da variante de tom (contrato 12.0b, secao 3). */
  toneSeed?: string;
  kind?: 'TRANSACTION';
  type: TransactionType;
  amountCents: number;
  description: string | null;
  categoryId: string | null;
  date: string;
  paymentMethod: PaymentMethod | null;
  pendingField: PendingField | null;
  /** Ids de categoria oferecidos quando a escolha e ambigua (max 5). */
  categoryOptions: string[];
  /** 9b-1: cartao do lancamento (so despesa com CREDIT). Ausente em rascunho antigo = null. */
  cardId?: string | null;
  cardName?: string | null;
  /** Ids dos cartoes oferecidos quando "credito" nao tem nome e ha mais de um cartao. */
  cardOptions?: string[];
}

/** Rascunho de meta nova (contrato 3b1, secao 3). */
export interface GoalDraft {
  kind: 'GOAL';
  /** 2 a 60 caracteres; null enquanto não informado. */
  title: string | null;
  /** Centavos; null = sem alvo ou ainda não informado (pendingField 'target' distingue). */
  targetCents: number | null;
  /** true quando o usuário respondeu "sem alvo" (cofrinho). */
  noTarget: boolean;
  pendingField: 'title' | 'target' | null;
}

/** Rascunho de aporte em meta ativa (contrato 3b1, secao 3). */
export interface ContributionDraft {
  kind: 'CONTRIBUTION';
  /** messageId de quem abriu o rascunho: semente da variante de tom. */
  toneSeed?: string;
  goalId: string | null;
  /** Para mostrar; o id é a fonte da verdade. */
  goalTitle: string | null;
  amountCents: number | null;
  /** 'AAAA-MM-DD' no fuso do usuário (hoje, na abertura). */
  date: string;
  /** Ids de metas oferecidas quando a escolha é ambígua (max 5). */
  goalOptions: string[];
  pendingField: 'amount' | 'goal' | null;
}

/** Tudo que `ConversationSession.draft` pode guardar. O motor decide pelo `kind`. */
export interface EnvelopeDraft {
  kind: 'ENVELOPE';
  name: string | null;
  monthlyCents: number | null;
  color: string;
  provisionMonth: string;
  pendingField: 'name' | 'amount' | null;
  /** Aviso persistido para permanecer visível também ao restaurar o cartão. */
  reviewReason?: string;
}

export interface CreditLimitDraft {
  kind: 'CREDIT_LIMIT';
  ceilingCents: number | null;
  cycleStart: string;
  cycleEnd: string;
  previousCeilingCents: number | null;
  countAllPayments: boolean;
  pendingField: 'amount' | null;
  reviewReason?: string;
  /** 8d: 'clear' remove o teto (confirmacao com a palavra limpar). Ausente em rascunho antigo = 'set'. */
  action?: 'set' | 'clear';
  /** 8d: cartao escolhido pelo nome (no clear, sempre resolve para um cartao). null = padrao no confirmar. */
  cardId?: string | null;
  cardName?: string | null;
}

/**
 * Renomear cartao por conversa (9b-3, secao 7). So guarda o id e o nome novo: a gravacao e do CreditCardsService,
 * que confere nome unico e cartao ativo sob o lock do User na confirmacao. pendingField nunca e usado (sempre confirmacao).
 */
export interface CardRenameDraft {
  kind: 'CARD_RENAME';
  cardId: string | null;
  currentName: string;
  newName: string;
  pendingField: null;
}

/**
 * Criar cartao por conversa (9b-3b). Nome e dias ficam no rascunho; o dia de fechamento e perguntado se nao veio na frase.
 * A gravacao e do CreditCardsService (sem regra nova). Cartao nunca vira padrao.
 */
export interface CardCreateDraft {
  kind: 'CARD_CREATE';
  name: string;
  closingDay: number | null;
  dueDay: number | null;
  pendingField: 'closingDay' | null;
}

/** Criar categoria por conversa (menu guiado, fatia 2): nome e tipo; cor automatica, sem icone nem orcamento. */
export interface CategoryCreateDraft {
  kind: 'CATEGORY_CREATE';
  name: string | null;
  type: 'EXPENSE' | 'INCOME' | null;
  pendingField: 'name' | 'type' | null;
}

/** Editar (so o nome) ou excluir categoria propria por conversa: lista, escolha pelo numero e confirmacao. */
export interface CategoryChangeDraft {
  kind: 'CATEGORY_CHANGE';
  action: 'EDIT' | 'DELETE';
  candidateIds: string[];
  /** A lista foi cortada em 15: as demais categorias ficam no app. */
  hasMore?: boolean;
  targetId: string | null;
  /** Nome da categoria quando foi escolhida: se mudar antes da confirmacao, nada e aplicado. */
  targetName: string | null;
  newName: string | null;
  pendingField: 'category' | 'name' | null;
}

/** Conta fixa (contrato 3b2b, secao 5): só despesa; categoria e pagamento ficam não informados. */
export interface RecurringDraft {
  kind: 'RECURRING';
  description: string | null;
  amountCents: number | null;
  frequency: 'MONTHLY' | 'WEEKLY' | 'YEARLY';
  /** 'AAAA-MM-DD', data-só; null enquanto não informado. */
  firstDueDate: string | null;
  pendingField: 'description' | 'amount' | 'firstDueDate' | null;
  reviewReason?: string;
}

/** Compra parcelada (contrato 3b2b, secao 5): totalCents é o total da compra, nunca o valor da parcela. */
export interface InstallmentDraft {
  kind: 'INSTALLMENT';
  /** messageId de quem abriu o rascunho: semente da variante de tom. */
  toneSeed?: string;
  description: string | null;
  totalCents: number | null;
  installmentsTotal: number | null;
  firstDueDate: string | null;
  pendingField: 'description' | 'amount' | 'installmentsTotal' | 'firstDueDate' | null;
  reviewReason?: string;
}

/**
 * Editar ou apagar lançamento por conversa (contrato 8a, secoes 3 a 6). Só guarda ids: o item é relido do banco com id + userId.
 * changes: campos a mudar (só EDIT). targetUpdatedAt: updatedAt do item quando foi escolhido (conflito, secao 5).
 */
export interface TransactionChangeDraft {
  kind: 'TRANSACTION_CHANGE';
  action: 'EDIT' | 'DELETE';
  /** Ids da lista numerada (máx. 5), enquanto o usuário não escolhe. */
  candidateIds: string[];
  targetId: string | null;
  targetUpdatedAt: string | null;
  changes: { amountCents?: number; description?: string; categoryId?: string | null; date?: string };
  pendingField: 'transaction' | 'change' | null;
  reviewReason?: string;
  /** Lista dos ultimos lancamentos (menu): quantos ja foram mostrados antes da pagina atual. Ausente = busca por termo. */
  listOffset?: number;
  /** Na lista dos ultimos: ha pagina seguinte. */
  hasMore?: boolean;
}

/**
 * Editar ou apagar meta ou reserva por conversa (contrato 8b, secoes 3 a 6). Mesma forma do 8a: só ids,
 * o alvo é relido do banco com id + userId. changes por alvo: meta usa title/targetCents/targetDate
 * (null = "sem alvo"/"sem prazo"); reserva usa name/monthlyCents.
 */
export interface TargetChangeDraft {
  kind: 'GOAL_CHANGE' | 'ENVELOPE_CHANGE' | 'RECURRING_CHANGE' | 'INSTALLMENT_CHANGE';
  action: 'EDIT' | 'DELETE';
  /** Ids da lista numerada (máx. 5), enquanto o usuário não escolhe. */
  candidateIds: string[];
  targetId: string | null;
  targetUpdatedAt: string | null;
  changes: {
    title?: string;
    targetCents?: number | null;
    targetDate?: string | null;
    name?: string;
    monthlyCents?: number;
    /** Conta fixa (contrato 8c): descricao/valor/data final ('sem prazo' = null). */
    description?: string;
    amountCents?: number;
    endDate?: string | null;
  };
  pendingField: 'targetChoice' | 'change' | null;
  reviewReason?: string;
}

export type SessionDraft =
  | ExpenseOrIncomeDraft
  | GoalDraft
  | ContributionDraft
  | EnvelopeDraft
  | CreditLimitDraft
  | RecurringDraft
  | InstallmentDraft
  | TransactionChangeDraft
  | TargetChangeDraft
  | CardRenameDraft
  | CardCreateDraft
  | CategoryCreateDraft
  | CategoryChangeDraft;

/** Dados numericos para a tela (centavos). Presentes em INFO e DONE. */
export interface ReplyData {
  balanceCents?: number;
  incomeCents?: number;
  expenseCents?: number;
  categories?: Array<{ name: string; amountCents: number }>;
  /** Meta criada ou aportada (DONE). */
  goalId?: string;
  envelopeId?: string;
  /** Conta fixa e compra parcelada criadas por conversa (3b2b). */
  recurringTransactionId?: string;
  installmentPurchaseId?: string;
  /** Reservas ativas (envelopes), contrato 3b1 parte A. Centavos; available pode ser negativo. */
  envelopes?: Array<{ label: string; monthlyCents: number; availableCents: number; spentCents: number }>;
  card?: {
    ceilingCents: number | null;
    spentCents: number;
    remainingCents: number | null;
    percentUsed: number | null;
    closingDay: number;
    dueDay: number | null;
  };
  transactionId?: string;
  /** Categoria criada, renomeada ou excluida por conversa (DONE). */
  categoryId?: string;
  /** 9b-3: cartao renomeado (DONE). */
  cardId?: string;
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
  /** Tela do app que a resposta sugere abrir (item 4c: 'imports' para "importar nota"). */
  screen?: 'imports';
  /** Total a pagar (installments), total da janela (upcoming_dues), total mensal estimado (fixed_bills), total disponivel (envelopes). */
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
  /** Resposta veio do fallback de IA (ASSISTANT_AI_MODE=fallback). Nunca vem de escrita. */
  aiFallback?: true;
  /** Menu por botao/lista (kind MENU): o canal desenha; o text ja serve de lista numerada. */
  menu?: MenuView;
}
