import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationChannel,
  ConversationOutcome,
  ConversationState,
  PaymentMethod,
  Prisma,
  TransactionType,
} from '@prisma/client';
import { CreditCycleService } from '../credit-cycle/credit-cycle.service';
import { EnvelopesService } from '../envelopes/envelopes.service';
import { EnvelopeMonthChangedError, EnvelopeWriteUncertainError } from '../envelopes/conversation-write.types';
import { monthStart } from '../envelopes/envelope.util';
import { CreditLimitChangedError, CreditLimitWriteUncertainError } from '../credit-cycle/conversation-write.types';
import {
  ConversationWriteRules,
  RecurringFirstDueChangedError,
  RecurringWriteUncertainError,
} from '../recurring-transactions/conversation-write.types';
import {
  InstallmentFirstDueChangedError,
  InstallmentWriteUncertainError,
  splitInstallments,
} from '../installments/conversation-write.types';
import {
  BodyFailure,
  DueResolution,
  parseInstallmentBody,
  INSTALLMENTS_MAX,
  INSTALLMENTS_MIN,
  parseRecurringBody,
  resolveFirstDue,
} from './parsers/write-body.parser';
import { AssistantFallbackOutcome, AssistantService } from '../assistant/assistant.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { PlanLimitException } from '../billing/plan-limit.exception';
import { GoalsService } from '../goals/goals.service';
import { InstallmentsService } from '../installments/installments.service';
import { addDaysUtc, localToday, monthToDateUtc } from '../recurring-transactions/recurrence.util';
import { RecurringTransactionsService } from '../recurring-transactions/recurring-transactions.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { parseAmountPrefix, AmountFailure } from './parsers/amount.parser';
import { extractDate } from './parsers/date.parser';
import {
  GOAL_TITLE_MAX,
  GOAL_TITLE_MIN,
  isNoTargetAnswer,
  parseCofrinhoBody,
  parseContributionBody,
  parseCreateGoalBody,
  splitTrailingAmount,
} from './parsers/goal.parser';
import { normalize } from './parsers/normalize';
import { MENU_ROOT, MENU_ROOT_ID } from './menu/menu.tree';
import { getMenuNode } from './menu/menu.tree.queries';
import { ExitKind, exitKindOf, isGreeting } from './menu/exit-words';
import { greetingFor } from './menu/greeting';
import { MENU_REPLIES, menuText, menuViewOf, withDica } from './menu/menu.view';
import { MenuActionInput, MenuNode } from './menu/menu.types';
import type { TargetChangeDraft, TransactionChangeDraft } from './conversation.types';
import { UpdateTransactionDto } from '../transactions/dto/update-transaction.dto';
import { UpdateGoalDto } from '../goals/dto/update-goal.dto';
import { UpdateEnvelopeDto } from '../envelopes/dto/update-envelope.dto';
import { UpdateRecurringTransactionDto } from '../recurring-transactions/dto/update-recurring-transaction.dto';
import {
  FREQ_PT,
  RC_REPLIES,
  describeInstallment,
  describeRecurring,
  formatInstallmentLine,
  formatRecurringLine,
  parseRecurringChange,
  type InstallmentCandidate,
  type RecurringCandidate,
} from './recurring-change';
import {
  TG_REPLIES,
  TARGET_CHANGE_MAX_CANDIDATES,
  TARGET_LIST_MAX,
  type EnvelopeCandidate,
  type GoalCandidate,
  STATUS_PT,
  describeEnvelope,
  describeGoal,
  formatDateFull,
  formatEnvelopeLine,
  formatGoalLine,
  isTargetChangeDraft,
  matchesName,
  parseTargetChange,
} from './target-change';
import {
  TX_CHANGE_MAX_CANDIDATES,
  TX_LIST_PAGE_SIZE,
  formatCompactLine,
  TX_CHANGE_WINDOW_DAYS,
  TX_DAY_MS,
  TX_REPLIES,
  TxCandidate,
  describeCandidate,
  formatCandidateLine,
  formatCents,
  formatDayMonth,
  isDeleteChange,
  isTransactionChangeDraft,
  matchesSearch,
  parseChange,
  parseSearch,
} from './transaction-change';
import { CL_REPLIES, ChatCard, cleanCardTerm, isClearLimitDraft, matchCardsByTerm, parseLimitBody } from './credit-limit';
import { CARD_EXPENSE_REPLIES, findCardPhrase, removeTokenRange } from './card-expense';
import { CARD_READ_REPLIES, cardListText, namedCardText } from './card-read';
import {
  CARD_WRITE_REPLIES,
  CARD_NAME_MAX,
  CARD_NAME_MIN,
  cardCreateDraftText,
  cardPickLine,
  cardCreatedText,
  cardRenameDraftText,
  cardRenamedText,
  nameTakenBy,
  parseCardCreate,
  parseCardRename,
  parseClosingDayAnswer,
} from './card-write';
import { FinanceCategoriesService } from '../finance-categories/finance-categories.service';
import {
  CATEGORY_PICK_MAX,
  CATEGORY_REPLIES,
  CategoryWriteUncertainError,
  categoryCreateDraftText,
  categoryNameTaken,
  categoryPickLine,
  categoryTypeLabel,
  checkCategoryName,
  isCategoryChangeDraft,
  nextCategoryColor,
  parseCategoryCreateBody,
  parseCategoryType,
} from './category-write';
import { MAX_ACTIVE_CARDS_PER_USER, CreditCardsService, CreditCardWriteUncertainError } from '../credit-cards/credit-cards.service';
import { CARD_ARCHIVED_MESSAGE, CARD_NEEDS_CREDIT_MESSAGE, CARD_NOT_FOUND_MESSAGE } from '../credit-cards/card-link';
import { parseEnvelopeBody } from './parsers/envelope.parser';
import { IntentMatch, ReadIntent, matchIntent } from './parsers/intent.matcher';
import {
  REPLIES,
  balanceText,
  cardText,
  categoryOptionsText,
  categoriesListText,
  CATEGORIES_EMPTY,
  categoryTotalText,
  contributionDoneText,
  contributionDraftText,
  creditLimitClearDraftText,
  creditLimitClearText,
  creditLimitDraftText,
  creditLimitSetText,
  doneText,
  installmentCreatedText,
  installmentDraftText,
  recurringCreatedText,
  recurringDraftText,
  draftText,
  envelopeCreatedText,
  envelopeDraftText,
  envelopesText,
  formatBrl,
  fixedBillsText,
  goalCreatedText,
  goalDraftText,
  goalLabel,
  goalNotFoundText,
  goalOptionsText,
  goalsText,
  installmentsText,
  longDate,
  monthSummaryText,
  monthYearUtc,
  spendTotalText,
  transactionRows,
  upcomingDuesText,
} from './replies';
import {
  ConversationInput,
  ConversationReply,
  ConversationReplyKind,
  ConversationStateView,
  ContributionDraft,
  CreditLimitDraft,
  CardRenameDraft,
  CardCreateDraft,
  CardPickDraft,
  CategoryChangeDraft,
  CategoryCreateDraft,
  DraftKind,
  DraftView,
  EnvelopeDraft,
  ExpenseOrIncomeDraft,
  GoalDraft,
  InstallmentDraft,
  RecurringDraft,
  ReplyData,
  SessionDraft,
} from './conversation.types';

/** Prazos do contrato (secao 5): coleta 15 min, confirmacao 5 min. */
const TTL_MS: Record<'COLLECTING_FIELDS' | 'AWAITING_CONFIRMATION', number> = {
  COLLECTING_FIELDS: 15 * 60_000,
  AWAITING_CONFIRMATION: 5 * 60_000,
};

const CONFIRM_WORDS = new Set(['confirmar', 'sim', 'ok']);
const CONNECTORS = new Set(['na', 'no', 'em', 'de', 'do', 'da', 'com', 'pra', 'para']);
const MAX_CATEGORY_OPTIONS = 5;
/** Lista completa de categorias oferecida quando a descricao nao casa com nenhuma. */
const MAX_CATEGORY_LIST = 10;
/** Reserva criada pelo bot: cor da primeira opção do formulário; sem ícone (contrato 3b2, seção 4). */
const ENVELOPE_COLOR = '#f18f01';
const ENVELOPE_NAME_MIN = 2;
const ENVELOPE_NAME_MAX = 60;
/** Conta fixa e parcelado: frequência padrão visível no cartão (contrato 3b2, secao 4). */
const DEFAULT_RECURRING_FREQUENCY = 'MONTHLY';
/** Conta fixa e parcelado criados pelo bot: vencimento anterior a hoje não grava (núcleo do serviço). */
const RECURRING_WRITE_RULES: ConversationWriteRules = { notBefore: 'today' };
/** Opções numeradas de meta na pergunta de aporte (contrato 3b1, secao 3). */
const MAX_GOAL_OPTIONS = 5;
const DESCRIPTION_MIN = 2;
const DESCRIPTION_MAX = 120;
const READ_INTENTS: Array<ReadIntent | 'credit_card'> = [
  'balance',
  'month_summary',
  'spend_total',
  'upcoming_dues',
  'installments',
  'fixed_bills',
  'goals',
  'envelopes',
  'credit_card',
  'list_cards',
  'categories',
];
/** Janela de "o que vence" em dias, a partir de hoje no fuso do usuário (contrato D4). */
const UPCOMING_WINDOW_DAYS = 30;
/** Limite de linhas na consulta de vencimentos (contrato D5). */
const UPCOMING_MAX_ITEMS = 8;
/** Limite de linhas nas demais listas (contrato D5). */
const LIST_MAX_ITEMS = 5;
/** Linhas na lista de categorias com totais do mes. */
const CATEGORIES_LIST_MAX = 15;
/** Tamanho máximo de descrição/título em uma linha da resposta (contrato secao 5). */
const LINE_MAX_CHARS = 60;
const MAX_GOAL_PERCENT = 100;
const WEEKS_PER_YEAR = 52;
const MONTHS_PER_YEAR = 12;

/** Linhas lidas dos serviços (só os campos que as consultas usam). */
interface RecurringRow {
  description: string;
  type: TransactionType;
  frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  amount: number;
  isActive: boolean;
  nextDueDate: Date;
}
interface InstallmentRow {
  description: string;
  installmentAmount: number;
  installmentsTotal: number;
  installmentsGenerated: number;
  remainingAmount: number;
  remainingInstallments: number;
  isActive: boolean;
  nextDueDate: Date | null;
}
interface GoalRow {
  title: string;
  status: 'PLANNED' | 'ACTIVE' | 'ACHIEVED' | 'PAUSED';
  targetAmount: number | null;
  currentAmount: number;
  targetDate: Date | null;
}
/** Meta com dono e id (escrita por conversa). userId é conferido na leitura, não só no serviço. */
interface OwnedGoalRow extends GoalRow {
  id: string;
  userId: string;
}
/** Meta já em centavos, pronta para o motor (id e dono conferidos em listGoals). */
/** Semente do tom (messageId de abertura). Rascunhos sem campo usam texto vazio: sempre a mesma variante. */
function toneSeedOf(draft: SessionDraft): string | undefined {
  return 'toneSeed' in draft ? draft.toneSeed : undefined;
}

interface GoalSnap {
  id: string;
  title: string;
  status: GoalRow['status'];
  targetCents: number | null;
  currentCents: number;
}
/** Resultado de gravar meta ou aporte (GoalsService.create/contribute serializam o Prisma). */
interface SavedGoal {
  id: string;
  title: string;
  status: string;
  targetAmount: number | null;
  currentAmount: number;
}
interface EnvelopeRow {
  name: string;
  isActive: boolean;
  monthlyAmount: number;
  available: number;
  spent: number;
}

/** Frequências em maiúscula para o cartão da conta fixa. */
const FREQUENCY_ROW_LABEL = { WEEKLY: 'Semanal', MONTHLY: 'Mensal', YEARLY: 'Anual' } as const;

/** Resposta de preencher um campo: atualizou o rascunho, ou pede de novo, ou erro. */
type PendingAnswer =
  | { status: 'UPDATED' }
  | { status: 'ASK'; outcome: ConversationOutcome; question: string; prefix?: string }
  | { status: 'ERROR'; text: string };

/** Efeito da confirmação já gravado: texto e dados para a tela. */
interface AppliedAction {
  text: string;
  data: ReplyData;
  resultRef: string;
  /** Gravação feita, enriquecimento posterior falhou: a tela precisa ser conferida (contrato 3). */
  refreshPending?: boolean;
  /** Gravação feita, materialização dos lançamentos falhou (conta fixa e parcelado). */
  materializationPending?: boolean;
}

type CategoryRow = { id: string; name: string };

/** Resultado da busca de lançamentos para editar/apagar (contrato 8a, secao 3). */
type TxSearch = { status: 'FOUND'; ids: string[] } | { status: 'NONE' } | { status: 'ONLY_NON_EDITABLE' };

interface DashboardFinances {
  finances: { balance: number; monthlyIncome: number; monthlyExpenses: number };
}

type SessionRow = {
  id: string;
  userId: string;
  channel: ConversationChannel;
  state: ConversationState;
  intent: string;
  draft: Prisma.JsonValue;
  version: number;
  expiresAt: Date;
};

/**
 * Motor de conversa. Canal-agnostico: recebe identidade já resolvida e nunca fala HTTP.
 * Todo acesso ao Prisma leva userId no where (sessao e evento).
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  /** Mensagens cujo fallback de IA está em voo (neste processo). A reentrega do mesmo messageId não pode cobrar duas vezes. */
  private readonly fallbackInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
    private readonly creditCycle: CreditCycleService,
    private readonly transactions: TransactionsService,
    private readonly recurring: RecurringTransactionsService,
    private readonly installments: InstallmentsService,
    private readonly goals: GoalsService,
    private readonly envelopes: EnvelopesService,
    private readonly entitlements: EntitlementsService,
    private readonly configService: ConfigService,
    private readonly assistant: AssistantService,
    private readonly creditCards: CreditCardsService,
    private readonly financeCategories: FinanceCategoriesService,
  ) {}

  /** Mensagem digitada (canal APP ou WhatsApp). Ordem de decisao: contrato secao 6 e motor. */
  async handleMessage(input: ConversationInput): Promise<ConversationReply> {
    const { userId, channel, messageId, receivedAt } = input;
    const text = input.text.trim();

    const duplicate = await this.prisma.conversationEvent.findFirst({
      where: { userId, channel, messageId },
      select: { id: true },
    });
    const session = await this.loadSession(userId, channel);

    if (duplicate) {
      return this.reply('DUPLICATE', this.stateView(session), REPLIES.duplicate);
    }
    if (session && session.expiresAt < receivedAt) {
      return this.expireSession(userId, session, messageId);
    }
    if (session) {
      return this.handleWithSession({ input, session, text });
    }
    return this.handleWithoutSession({ input, text });
  }

  /**
   * Botao "Confirmar" (deleteExplicit = botão "Apagar de vez" do cartão de apagar). Null = 404 no controller
   * (inexistente, outra conta, versao antiga ou já consumido). Rascunho de apagar só aplica com deleteExplicit,
   * que equivale à palavra "apagar" digitada (contrato 8a, secao 4). Sem a flag, o texto de sempre, sem gravar.
   */
  async confirmDraft(userId: string, draftId: string, draftVersion: number, deleteExplicit = false, clearExplicit = false): Promise<ConversationReply | null> {
    const session = await this.prisma.conversationSession.findFirst({
      where: { id: draftId, userId, state: ConversationState.AWAITING_CONFIRMATION },
    });
    if (!session || session.version !== draftVersion) {
      return null;
    }
    if (isDeleteChange(session.draft) && !deleteExplicit) {
      // Botão "Confirmar" não apaga: a ação de apagar é a palavra "apagar" ou a ação explícita do cartão (decisão do dono).
      return this.reply('ERROR', this.stateView(session), TX_REPLIES.deleteNeedsWord);
    }
    if (isClearLimitDraft(session.draft) && !clearExplicit) {
      // 8d (D3 do dono): limpar teto so com a palavra "limpar" ou a acao explicita do cartao.
      return this.reply('ERROR', this.stateView(session), CL_REPLIES.clearNeedsWord);
    }
    const now = new Date();
    if (session.expiresAt < now) {
      return this.expireSession(userId, session, null);
    }
    return this.applyDraft({ userId, session, messageId: null, now });
  }

  /** Botao "Cancelar". Null = 404 no controller. */
  async cancelDraft(userId: string, draftId: string): Promise<ConversationReply | null> {
    const session = await this.prisma.conversationSession.findFirst({ where: { id: draftId, userId } });
    if (!session) {
      return null;
    }
    if (session.expiresAt < new Date()) {
      return this.expireSession(userId, session, null);
    }
    return this.cancelSession(userId, session, null);
  }

  /**
   * Estado para o app reabrir a conversa. A sessao do canal APP manda. Sem ela, um rascunho do WhatsApp
   * que espera confirmacao tambem aparece, para o usuario confirmar pelo botao do app (a escrita pelo
   * WhatsApp pode estar desligada). Sempre so do proprio usuario. Sem sessao ativa = IDLE.
   */
  async getSession(userId: string): Promise<{ state: ConversationStateView; draft?: DraftView }> {
    const now = new Date();
    const app = await this.loadSession(userId, ConversationChannel.APP);
    if (app && app.expiresAt >= now) {
      return { state: app.state, draft: await this.toDraftView(app) };
    }
    const whatsapp = await this.loadSession(userId, ConversationChannel.WHATSAPP);
    if (whatsapp && whatsapp.expiresAt >= now && whatsapp.state === ConversationState.AWAITING_CONFIRMATION) {
      return { state: whatsapp.state, draft: await this.toDraftView(whatsapp) };
    }
    // Rascunho do Telegram tambem espera confirmacao no app (D9 do item 5 estendido ao canal do item 10).
    const telegram = await this.loadSession(userId, ConversationChannel.TELEGRAM);
    if (telegram && telegram.expiresAt >= now && telegram.state === ConversationState.AWAITING_CONFIRMATION) {
      return { state: telegram.state, draft: await this.toDraftView(telegram) };
    }
    return { state: 'IDLE' };
  }

  // ---------- menu por botao e saida universal (12.1a) ----------

  /**
   * Clique do menu. Sem estado no servidor: o destino vem do id do no (conferido na arvore) e o dono so do vinculo.
   * Mesmo messageId de novo = DUPLICATE. Id desconhecido cai no menu inicial, sem erro.
   */
  async handleMenuAction(input: MenuActionInput): Promise<ConversationReply> {
    const { userId, channel, messageId, receivedAt } = input;
    const duplicate = await this.prisma.conversationEvent.findFirst({
      where: { userId, channel, messageId },
      select: { id: true },
    });
    const session = await this.loadSession(userId, channel);
    if (duplicate) {
      return this.reply('DUPLICATE', this.stateView(session), REPLIES.duplicate);
    }
    if (session && session.expiresAt < receivedAt) {
      return this.expireSession(userId, session, messageId);
    }
    const node = getMenuNode(input.nodeId) ?? MENU_ROOT;
    const action = node.action;
    if (node.children || !action) {
      return this.openMenuNode(input, session, node);
    }
    if (action.type === 'instruction') {
      return this.menuInstruction(input, session, node, action.text);
    }
    return this.runMenuPhrase(input, action.phrase, node.example);
  }

  private async openMenuNode(input: MenuActionInput, session: SessionRow | null, node: MenuNode): Promise<ConversationReply> {
    const intent = node.id === MENU_ROOT_ID ? 'menu_open' : `menu_nav:${node.id}`;
    await this.recordEventRaw({ userId: input.userId, channel: input.channel, messageId: input.messageId, intent, outcome: ConversationOutcome.RECOGNIZED });
    const greeting = node.id === MENU_ROOT_ID ? await this.greetingOf(input.userId, input.receivedAt) : undefined;
    return { ...this.reply('MENU', this.stateView(session), menuText(node, greeting)), menu: menuViewOf(node, greeting) };
  }

  /** Folha de instrucao: a frase pronta para digitar. Nao grava nada. */
  private async menuInstruction(input: MenuActionInput, session: SessionRow | null, node: MenuNode, text: string): Promise<ConversationReply> {
    await this.recordEventRaw({ userId: input.userId, channel: input.channel, messageId: input.messageId, intent: `menu_nav:${node.id}`, outcome: ConversationOutcome.RECOGNIZED });
    return this.reply('HELP', this.stateView(session), withDica(text, node.example));
  }

  /** Folha de frase: executa o mesmo caminho de handleMessage. O evento e o da propria acao (um por messageId). */
  private async runMenuPhrase(input: MenuActionInput, phrase: string, example: string | undefined): Promise<ConversationReply> {
    const reply = await this.handleMessage({ userId: input.userId, channel: input.channel, messageId: input.messageId, text: phrase, receivedAt: input.receivedAt, viaMenu: true });
    return reply.kind === 'DUPLICATE' ? reply : { ...reply, text: withDica(reply.text, example) };
  }

  /** Saida com rascunho aberto: cancela (texto de sempre) e mostra o menu inicial. */
  private async leaveDraft(userId: string, session: SessionRow, messageId: string, receivedAt: Date): Promise<ConversationReply> {
    const cancelled = await this.cancelSession(userId, session, messageId);
    const greeting = await this.greetingOf(userId, receivedAt);
    return { ...cancelled, text: `${cancelled.text}\n\n${menuText(MENU_ROOT, greeting)}`, menu: { ...menuViewOf(MENU_ROOT, greeting), lead: cancelled.text } };
  }

  /** Saida sem rascunho: "voltar"/"menu" mostram o menu; cancelar sem nada aberto avisa antes. */
  private async leaveWithoutDraft(input: ConversationInput, kind: ExitKind): Promise<ConversationReply> {
    await this.recordEvent(input, 'menu_open', ConversationOutcome.RECOGNIZED);
    const greeting = await this.greetingOf(input.userId, input.receivedAt);
    const menu = { ...this.reply('MENU', 'IDLE', menuText(MENU_ROOT, greeting)), menu: menuViewOf(MENU_ROOT, greeting) };
    return kind === 'CANCEL'
      ? { ...menu, text: `${MENU_REPLIES.nothingToCancel}\n\n${menu.text}`, menu: { ...menu.menu, lead: MENU_REPLIES.nothingToCancel } }
      : menu;
  }

  // ---------- sem sessao ativa ----------

  private async handleWithoutSession(args: { input: ConversationInput; text: string }): Promise<ConversationReply> {
    const { input, text } = args;
    const exit = exitKindOf(text);
    if (exit) {
      return this.leaveWithoutDraft(input, exit);
    }
    if (isGreeting(text)) {
      return this.leaveWithoutDraft(input, 'MENU');
    }
    const intent = await this.resolveLooseCardRead(input.userId, text.length > 0 ? matchIntent(text) : null);

    if (!intent) {
      const word = normalize(text);
      const control = CONFIRM_WORDS.has(word);
      return this.handleUnrecognized(input, text, control);
    }
    if (intent.intent === 'create_expense' || intent.intent === 'create_income') {
      return this.startDraft({ input, intent });
    }
    if (intent.intent === 'create_goal') {
      return this.startGoalDraft({ input, body: intent.body, cofrinho: intent.cofrinho === true });
    }
    if (intent.intent === 'contribute_goal') {
      return this.startContributionDraft({ input, body: intent.body, text });
    }
    if (intent.intent === 'create_envelope') {
      return this.startEnvelopeDraft({ input, body: intent.body });
    }
    if (intent.intent === 'set_credit_limit' && intent.body.trim() === '') {
      return this.startCardPick({ input, purpose: 'SET_LIMIT' });
    }
    if (intent.intent === 'set_credit_limit') {
      return this.startCreditLimitDraft({ input, body: intent.body });
    }
    if (intent.intent === 'clear_credit_limit') {
      if (intent.body.trim() === '') return this.startCardPick({ input, purpose: 'CLEAR_LIMIT' });
      return this.startCreditLimitClearDraft({ input, body: intent.body });
    }
    if (intent.intent === 'create_card') {
      return this.startCardCreateDraft({ input, body: intent.body });
    }
    if (intent.intent === 'create_category') {
      return this.startCategoryCreateDraft({ input, body: intent.body });
    }
    if (intent.intent === 'edit_category' || intent.intent === 'delete_category') {
      return this.startCategoryChangeDraft({ input, action: intent.intent === 'delete_category' ? 'DELETE' : 'EDIT', body: intent.body });
    }
    if (intent.intent === 'rename_card') {
      if (intent.body.trim() === '') return this.startCardPick({ input, purpose: 'RENAME' });
      return this.startCardRenameDraft({ input, body: intent.body });
    }
    if (intent.intent === 'create_recurring') {
      return this.startRecurringDraft({ input, body: intent.body });
    }
    if (intent.intent === 'create_installment') {
      return this.startInstallmentDraft({ input, body: intent.body });
    }
    if (intent.intent === 'help') {
      await this.recordEvent(input, 'help', ConversationOutcome.RECOGNIZED);
      return this.reply('HELP', 'IDLE', REPLIES.help);
    }
    if (intent.intent === 'import_receipt') {
      return this.importReceiptReply(input, 'IDLE');
    }
    if (intent.intent === 'edit_transaction' || intent.intent === 'delete_transaction') {
      return this.startTransactionChange({
        input,
        action: intent.intent === 'delete_transaction' ? 'DELETE' : 'EDIT',
        body: intent.body,
      });
    }
    if (
      intent.intent === 'edit_goal' ||
      intent.intent === 'delete_goal' ||
      intent.intent === 'edit_envelope' ||
      intent.intent === 'delete_envelope' ||
      intent.intent === 'edit_recurring' ||
      intent.intent === 'delete_recurring' ||
      intent.intent === 'edit_installment' ||
      intent.intent === 'delete_installment'
    ) {
      // Editar/apagar meta, reserva, conta fixa ou parcelado (contratos 8b e 8c, secoes 3 a 5).
      if (intent.intent === 'edit_installment') {
        // D3 do dono: parcelado nao tem edicao nem na tela; pelo chat so apaga.
        await this.recordEvent(input, 'edit_installment', ConversationOutcome.RECOGNIZED);
        return this.reply('INFO', 'IDLE', RC_REPLIES.installmentNoEdit);
      }
      const kind: TargetChangeDraft['kind'] =
        intent.intent === 'edit_goal' || intent.intent === 'delete_goal'
          ? 'GOAL_CHANGE'
          : intent.intent === 'edit_envelope' || intent.intent === 'delete_envelope'
            ? 'ENVELOPE_CHANGE'
            : intent.intent === 'edit_recurring' || intent.intent === 'delete_recurring'
              ? 'RECURRING_CHANGE'
              : 'INSTALLMENT_CHANGE';
      return this.startTargetChange({
        input,
        kind,
        action: intent.intent.startsWith('delete_') ? 'DELETE' : 'EDIT',
        body: intent.body,
      });
    }
    return this.runRead(input, intent, 'IDLE');
  }

  /**
   * Texto que o motor não reconheceu. Em `off` é a ajuda de sempre (com `unrecognized` para o canal).
   * Em `fallback` o próprio motor decide: a IA responde (só leitura) ou a ajuda diz por que não respondeu.
   * Um único evento por messageId. Palavra de controle e texto vazio não chamam a IA.
   */
  private async handleUnrecognized(input: ConversationInput, text: string, controlWord: boolean): Promise<ConversationReply> {
    const fallback = this.configService.get<string>('app.assistantAiMode') === 'fallback';
    if (controlWord || !fallback || text === '') {
      await this.recordEvent(input, null, ConversationOutcome.UNRECOGNIZED);
      const help = this.reply('HELP', 'IDLE', REPLIES.unrecognized);
      return controlWord ? help : { ...help, unrecognized: true };
    }

    // O evento só é gravado depois da IA; sem esta trava, a reentrega durante a espera chamaria e cobraria de novo.
    const flightKey = `${input.userId}:${input.channel}:${input.messageId}`;
    if (this.fallbackInFlight.has(flightKey)) {
      return this.reply('DUPLICATE', 'IDLE', REPLIES.duplicate);
    }
    this.fallbackInFlight.add(flightKey);

    let outcome: AssistantFallbackOutcome;
    try {
      outcome = await this.assistant.tryFallbackAnswer(input.userId, text);
    } catch (error) {
      // Só o nome do erro: nunca a mensagem do usuário.
      this.logger.warn(`Fallback de IA falhou: erro=${error instanceof Error ? error.name : typeof error}`);
      outcome = { status: 'unavailable' };
    } finally {
      this.fallbackInFlight.delete(flightKey);
    }

    if (outcome.status === 'answered') {
      await this.recordEvent(input, 'ai_fallback', ConversationOutcome.AI_ANSWERED);
      return { ...this.reply('INFO', 'IDLE', outcome.text), aiFallback: true };
    }
    if (outcome.status === 'unavailable') {
      await this.recordEvent(input, 'ai_fallback', ConversationOutcome.AI_UNAVAILABLE);
      return this.reply('HELP', 'IDLE', REPLIES.aiFallbackUnavailable);
    }
    await this.recordEvent(input, 'ai_fallback', ConversationOutcome.AI_BLOCKED);
    const helpText = outcome.status === 'blocked_by_plan' ? REPLIES.aiFallbackBlocked : REPLIES.aiFallbackHelp;
    return this.reply('HELP', 'IDLE', helpText);
  }

  /** Só orienta e indica a tela: não cria rascunho nem sessão e não grava nada (contrato do item 4, secao 9). */
  private async importReceiptReply(input: ConversationInput, state: ConversationStateView): Promise<ConversationReply> {
    await this.recordEvent(input, 'import_receipt', ConversationOutcome.RECOGNIZED);
    return { ...this.reply('HELP', state, REPLIES.importReceipt), data: { screen: 'imports' } };
  }

  /** Cria rascunho novo. Nunca grava na primeira mensagem (contrato secao 6). */
  private async startDraft(args: {
    input: ConversationInput;
    intent: Extract<IntentMatch, { intent: 'create_expense' | 'create_income' }>;
  }): Promise<ConversationReply> {
    const { input, intent } = args;
    const { userId, receivedAt } = input;
    const type = intent.intent === 'create_income' ? TransactionType.INCOME : TransactionType.EXPENSE;
    const today = await this.todayYmd(userId, receivedAt);

    // "gastei mercado" (sem valor): guarda o que veio e pergunta o valor.
    const amount = intent.missingAmount === true ? null : parseAmountPrefix(intent.body);
    if (amount && amount.ok === false) {
      await this.recordEvent(input, intent.intent, ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', amountErrorText(amount.reason));
    }
    const cents = amount && amount.ok ? amount.cents : 0;
    const rest = amount && amount.ok ? amount.rest : intent.body;

    const dateResult = extractDate(splitTokens(rest), today);
    if (dateResult.invalid) {
      await this.recordEvent(input, intent.intent, ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', REPLIES.invalidDate);
    }

    // 9b-1: cartao no texto. Nome que nao casa (ou explicito ambiguo/inexistente) responde a lista e nao grava.
    const cards = type === TransactionType.EXPENSE ? await this.activeCards(userId) : [];
    const phrase = type === TransactionType.EXPENSE ? findCardPhrase(dateResult.rest, cards) : null;
    if (phrase && (phrase.kind === 'notFound' || phrase.kind === 'ambiguous')) {
      await this.recordEvent(input, intent.intent, ConversationOutcome.ERROR);
      return this.reply(
        'ERROR',
        'IDLE',
        phrase.kind === 'notFound'
          ? CL_REPLIES.cardNotFound(phrase.term, cards.map((card) => card.name))
          : CL_REPLIES.cardAmbiguous(phrase.term, phrase.hits.map((card) => card.name)),
      );
    }
    const cardTokens = phrase ? removeTokenRange(dateResult.rest, phrase.from, phrase.to) : dateResult.rest;
    const description = stripConnectors(cardTokens).join(' ');
    if (description.length > DESCRIPTION_MAX) {
      await this.recordEvent(input, intent.intent, ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', REPLIES.descriptionTooLong);
    }

    const draft: ExpenseOrIncomeDraft = {
      kind: 'TRANSACTION',
      toneSeed: input.messageId,
      type,
      amountCents: cents,
      description: description.length >= DESCRIPTION_MIN ? description : null,
      categoryId: null,
      date: dateResult.ymd,
      paymentMethod: null,
      pendingField: null,
      categoryOptions: [],
      cardId: null,
      cardName: null,
      cardOptions: [],
    };
    if (phrase && phrase.kind === 'card') {
      pickCard(draft, phrase.card);
    } else if (phrase && phrase.kind === 'credit' && cards.length === 1) {
      pickCard(draft, cards[0]);
    } else if (phrase && phrase.kind === 'credit' && cards.length > 1) {
      draft.cardOptions = cards.map((card) => card.id);
    } else if (phrase && (phrase.kind === 'creditDefault' || (phrase.kind === 'credit' && cards.length === 0))) {
      // Sem cartao nomeado e sem escolha: CREDIT sem cardId, a conta cai no cartao padrao (regra da 9a).
      draft.paymentMethod = PaymentMethod.CREDIT;
    }

    if (intent.missingAmount === true) {
      draft.pendingField = 'amount';
    } else if (draft.description === null) {
      draft.pendingField = 'description';
    } else {
      await this.resolveCategory(userId, draft, description);
    }
    settleCardChoice(draft);

    return this.saveNewDraft({ input, intent: intent.intent, draft, today });
  }

  /**
   * Criar meta. O limite do plano é checado ao abrir (D4): recusa sem abrir rascunho.
   * Nome e alvo vêm do corpo (parsers/goal.parser.ts) ou das perguntas seguintes.
   * "criar cofrinho" já nasce sem alvo: só o nome é perguntado, se faltar.
   */
  private async startGoalDraft(args: {
    input: ConversationInput;
    body: string;
    cofrinho: boolean;
  }): Promise<ConversationReply> {
    const { input, body, cofrinho } = args;
    const { userId, receivedAt } = input;
    try {
      await this.entitlements.assertCanCreate(userId, 'goals');
    } catch (error) {
      if (error instanceof PlanLimitException) {
        await this.recordEvent(input, 'create_goal', ConversationOutcome.ERROR);
        return this.reply('ERROR', 'IDLE', error.message);
      }
      throw error;
    }

    const parsed: ReturnType<typeof parseCreateGoalBody> = cofrinho
      ? { ok: true, title: parseCofrinhoBody(body), targetCents: null }
      : parseCreateGoalBody(body);
    if (parsed.ok === false) {
      await this.recordEvent(input, 'create_goal', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', amountErrorText(parsed.reason));
    }
    let title = parsed.title;
    if (title !== null && codePointLength(title) > GOAL_TITLE_MAX) {
      await this.recordEvent(input, 'create_goal', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', REPLIES.goalTitleTooLong);
    }
    if (title !== null && codePointLength(title) < GOAL_TITLE_MIN) {
      title = null;
    }
    if (title !== null && (await this.isGoalNameTaken(userId, title))) {
      await this.recordEvent(input, 'create_goal', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', REPLIES.goalNameTaken);
    }

    const draft: GoalDraft = {
      kind: 'GOAL',
      title,
      targetCents: parsed.targetCents ?? null,
      noTarget: parsed.targetCents === null,
      pendingField: title === null ? 'title' : parsed.targetCents === undefined ? 'target' : null,
    };
    return this.saveNewDraft({ input, intent: 'create_goal', draft, today: await this.todayYmd(userId, receivedAt) });
  }

  /**
   * Aporte em meta ativa. Meta única é usada sem perguntar; várias viram opções numeradas.
   * Não recusa por limite de plano: aporte não cria vaga.
   */
  private async startContributionDraft(args: { input: ConversationInput; body: string; text: string }): Promise<ConversationReply> {
    const { input, body, text } = args;
    const { userId, receivedAt } = input;
    const parsed = parseContributionBody(body);
    if (parsed.ok === false) {
      await this.recordEvent(input, 'contribute_goal', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', amountErrorText(parsed.reason));
    }

    const active = await this.activeGoals(userId);
    let { amountCents, name } = parsed;
    let candidates = name !== null ? matchGoalByTitle(name, active) : active;
    // "guardar viagem 200": valor depois do nome. Só vale quando o nome inteiro não casa com meta nenhuma.
    if (amountCents === null && name !== null && candidates.length === 0) {
      const trailing = splitTrailingAmount(name);
      if (trailing?.ok === false) {
        await this.recordEvent(input, 'contribute_goal', ConversationOutcome.ERROR);
        return this.reply('ERROR', 'IDLE', amountErrorText(trailing.reason));
      }
      if (trailing?.ok === true) {
        amountCents = trailing.amountCents;
        name = trailing.name;
        candidates = name !== null ? matchGoalByTitle(name, active) : active;
      }
    }
    // Sem valor e com um nome que não casa com nenhuma meta ativa ("guardar dinheiro é importante")
    // é conversa, não comando: vai ao Selah, sem rascunho e sem pedir valor.
    if (amountCents === null && name !== null && candidates.length === 0) {
      return this.handleUnrecognized(input, text, false);
    }
    if (active.length === 0) {
      await this.recordEvent(input, 'contribute_goal', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', REPLIES.noActiveGoals);
    }
    if (candidates.length === 0) {
      await this.recordEvent(input, 'contribute_goal', ConversationOutcome.ERROR);
      return this.reply(
        'ERROR',
        'IDLE',
        goalNotFoundText(active.slice(0, MAX_GOAL_OPTIONS).map((goal) => truncate(goal.title))),
      );
    }
    const goal = candidates.length === 1 ? candidates[0] : null;
    const draft: ContributionDraft = {
      kind: 'CONTRIBUTION',
      toneSeed: input.messageId,
      goalId: goal?.id ?? null,
      goalTitle: goal?.title ?? null,
      amountCents,
      date: await this.todayYmd(userId, receivedAt),
      goalOptions: goal ? [] : candidates.slice(0, MAX_GOAL_OPTIONS).map((candidate) => candidate.id),
      pendingField: nextContributionPending(goal?.id ?? null, amountCents),
    };
    return this.saveNewDraft({ input, intent: 'contribute_goal', draft, today: draft.date });
  }

  /**
   * Criar reserva. O plano é checado ao abrir; a duplicidade é conferida contra o nome exato
   * (unicidade userId + name do banco). Corpo: valor no início e nome depois (parsers/envelope.parser.ts).
   */
  private async startEnvelopeDraft(args: { input: ConversationInput; body: string }): Promise<ConversationReply> {
    const { input, body } = args;
    const { userId, receivedAt } = input;
    try {
      await this.entitlements.assertCanCreate(userId, 'envelopes');
    } catch (error) {
      if (error instanceof PlanLimitException) {
        await this.recordEvent(input, 'create_envelope', ConversationOutcome.ERROR);
        return this.reply('ERROR', 'IDLE', error.message);
      }
      throw error;
    }

    const parsed = parseEnvelopeBody(body);
    if (parsed.ok === false) {
      await this.recordEvent(input, 'create_envelope', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', amountErrorText(parsed.reason));
    }
    let name = parsed.name;
    if (name !== null && codePointLength(name) > ENVELOPE_NAME_MAX) {
      await this.recordEvent(input, 'create_envelope', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', REPLIES.envelopeNameTooLong);
    }
    if (name !== null && codePointLength(name) < ENVELOPE_NAME_MIN) {
      name = null;
    }
    if (name !== null && (await this.isEnvelopeNameTaken(userId, name))) {
      await this.recordEvent(input, 'create_envelope', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', REPLIES.envelopeNameTaken);
    }

    const draft: EnvelopeDraft = {
      kind: 'ENVELOPE',
      name,
      monthlyCents: parsed.monthlyCents,
      color: ENVELOPE_COLOR,
      provisionMonth: monthYmd(receivedAt),
      pendingField: envelopePending(name, parsed.monthlyCents),
    };
    return this.saveNewDraft({ input, intent: 'create_envelope', draft, today: await this.todayYmd(userId, receivedAt) });
  }

  /**
   * Definir limite do cartao (8d): o corpo aceita "valor", "cartao valor", "cartao" ou nada. O cartao
   * e escolhido pelo nome (termo desconhecido ou ambiguo pede reenvio listando os cartões; sem nome = padrao).
   * O ciclo e o teto vigente sao lidos agora, do cartao escolhido, e conferidos de novo na confirmacao
   * sob bloqueio (CreditCycleService).
   */
  private async startCreditLimitDraft(args: { input: ConversationInput; body: string }): Promise<ConversationReply> {
    const { input, body } = args;
    const { userId, receivedAt } = input;

    const parsed = parseLimitBody(body);
    if (parsed.status === 'error') {
      await this.recordEvent(input, 'set_credit_limit', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', amountErrorText(parsed.reason));
    }
    const ceilingCents =
      parsed.status === 'amount' ? parsed.cents : parsed.status === 'card' ? parsed.cents : null;

    const chosen = await this.resolveChatCard(userId, parsed.status === 'card' ? parsed.term : '');
    if ('errorText' in chosen) {
      await this.recordEvent(input, 'set_credit_limit', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', chosen.errorText);
    }
    const card = chosen.card;

    // Leitura do ciclo antes de gravar o rascunho: falha vira ERROR genérico, como nas leituras (runRead).
    let cycle: Awaited<ReturnType<CreditCycleService['getCurrent']>>;
    try {
      cycle = card ? await this.creditCycle.getCycleForCard(userId, card.id) : await this.creditCycle.getCurrent(userId);
    } catch (error) {
      // Só o id da intenção e o nome do erro: nunca a mensagem, o texto do usuário ou valores.
      this.logger.warn(`Leitura falhou: intent=set_credit_limit erro=${error instanceof Error ? error.name : typeof error}`);
      await this.recordEvent(input, 'set_credit_limit', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', REPLIES.consultError);
    }
    const draft: CreditLimitDraft = {
      kind: 'CREDIT_LIMIT',
      action: 'set',
      ceilingCents,
      cardId: card?.id ?? null,
      cardName: card?.name ?? null,
      cycleStart: toYmd(new Date(cycle.cycleStart)),
      cycleEnd: toYmd(new Date(cycle.cycleEnd)),
      previousCeilingCents: cycle.ceiling === null ? null : toCents(cycle.ceiling),
      countAllPayments: cycle.countAllPayments,
      pendingField: ceilingCents === null ? 'amount' : null,
    };
    return this.saveNewDraft({ input, intent: 'set_credit_limit', draft, today: await this.todayYmd(userId, receivedAt) });
  }

  /**
   * Limpar o teto do ciclo (D1 do 8d): cartao pelo nome ou padrao — no padrao o cartao fica salvo no
   * rascunho, entao trocar o padrao no meio nao limpa o teto de outro. Ciclo sem teto e recusa imediata,
   * sem rascunho; com teto, a previa pede a palavra "limpar" (D3).
   */
  private async startCreditLimitClearDraft(args: { input: ConversationInput; body: string }): Promise<ConversationReply> {
    const { input, body } = args;
    const { userId, receivedAt } = input;

    const chosen = await this.resolveChatCard(userId, cleanCardTerm(body.trim()));
    if ('errorText' in chosen) {
      await this.recordEvent(input, 'clear_credit_limit', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', chosen.errorText);
    }
    let card = chosen.card;
    if (card === null) {
      card = await this.prisma.creditCard.findFirst({
        where: { userId, isDefault: true, archivedAt: null },
        select: { id: true, name: true },
      });
      if (!card) {
        this.logger.warn('Leitura falhou: intent=clear_credit_limit erro=semCartaoPadrao');
        await this.recordEvent(input, 'clear_credit_limit', ConversationOutcome.ERROR);
        return this.reply('ERROR', 'IDLE', REPLIES.consultError);
      }
    }

    const prepared = await this.prepareClearLimitDraft(userId, card);
    if ('errorText' in prepared) {
      await this.recordEvent(input, 'clear_credit_limit', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', prepared.errorText);
    }
    if ('alreadyClear' in prepared) {
      await this.recordEvent(input, 'clear_credit_limit', ConversationOutcome.RECOGNIZED);
      return this.reply('INFO', 'IDLE', CL_REPLIES.alreadyClear);
    }
    return this.saveNewDraft({ input, intent: 'clear_credit_limit', draft: prepared.draft, today: await this.todayYmd(userId, receivedAt) });
  }

  /** Cartao escolhido para definir o teto: le o ciclo atual e monta o rascunho que pergunta o valor. Nao grava nada. */
  private async prepareSetLimitDraft(userId: string, card: { id: string; name: string }): Promise<{ draft: CreditLimitDraft } | { errorText: string }> {
    let cycle: Awaited<ReturnType<CreditCycleService['getCurrent']>>;
    try {
      cycle = await this.creditCycle.getCycleForCard(userId, card.id);
    } catch (error) {
      this.logger.warn(`Leitura falhou: intent=set_credit_limit erro=${error instanceof Error ? error.name : typeof error}`);
      return { errorText: REPLIES.consultError };
    }
    return {
      draft: {
        kind: 'CREDIT_LIMIT',
        action: 'set',
        ceilingCents: null,
        cardId: card.id,
        cardName: card.name,
        cycleStart: toYmd(new Date(cycle.cycleStart)),
        cycleEnd: toYmd(new Date(cycle.cycleEnd)),
        previousCeilingCents: cycle.ceiling === null ? null : toCents(cycle.ceiling),
        countAllPayments: cycle.countAllPayments,
        pendingField: 'amount',
      },
    };
  }

  /** Cartao escolhido: le o ciclo atual e monta o rascunho de limpar o teto (ou diz que nao ha teto). Nao grava nada. */
  private async prepareClearLimitDraft(
    userId: string,
    card: { id: string; name: string },
  ): Promise<{ draft: CreditLimitDraft } | { errorText: string } | { alreadyClear: true }> {
    let cycle: Awaited<ReturnType<CreditCycleService['getCurrent']>>;
    try {
      cycle = await this.creditCycle.getCycleForCard(userId, card.id);
    } catch (error) {
      this.logger.warn(`Leitura falhou: intent=clear_credit_limit erro=${error instanceof Error ? error.name : typeof error}`);
      return { errorText: REPLIES.consultError };
    }
    if (cycle.ceiling === null) {
      return { alreadyClear: true };
    }
    const draft: CreditLimitDraft = {
      kind: 'CREDIT_LIMIT',
      action: 'clear',
      ceilingCents: null,
      cardId: card.id,
      cardName: card.name,
      cycleStart: toYmd(new Date(cycle.cycleStart)),
      cycleEnd: toYmd(new Date(cycle.cycleEnd)),
      previousCeilingCents: toCents(cycle.ceiling),
      countAllPayments: cycle.countAllPayments,
      pendingField: null,
    };
    return { draft };
  }

  /** Criar categoria: nome e tipo (despesa ou receita); o que faltar e perguntado. Cor automatica, sem icone nem orcamento. */
  private async startCategoryCreateDraft(args: { input: ConversationInput; body: string }): Promise<ConversationReply> {
    const { input, body } = args;
    const { userId, receivedAt } = input;
    const parsed = parseCategoryCreateBody(body);
    let name: string | null = null;
    if (parsed.name !== null) {
      const checked = checkCategoryName(parsed.name);
      if (checked.ok === false) {
        await this.recordEvent(input, 'create_category', ConversationOutcome.ERROR);
        return this.reply('ERROR', 'IDLE', checked.text);
      }
      name = checked.name;
    }
    if (name !== null && parsed.type !== null && (await this.isCategoryNameTaken(userId, name, parsed.type))) {
      await this.recordEvent(input, 'create_category', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', CATEGORY_REPLIES.nameTaken);
    }
    const draft: CategoryCreateDraft = {
      kind: 'CATEGORY_CREATE',
      name,
      type: parsed.type,
      pendingField: name === null ? 'name' : parsed.type === null ? 'type' : null,
    };
    return this.saveNewDraft({ input, intent: 'create_category', draft, today: await this.todayYmd(userId, receivedAt) });
  }

  private async isCategoryNameTaken(userId: string, name: string, type: string, exceptId = ''): Promise<boolean> {
    const own = await this.prisma.financeCategory.findMany({ where: { userId, type: type as TransactionType }, select: { id: true, name: true, type: true } });
    return categoryNameTaken(own, name, type, exceptId);
  }

  private async answerCategoryCreate(userId: string, draft: CategoryCreateDraft, value: string): Promise<PendingAnswer> {
    if (draft.pendingField === 'name') {
      const checked = checkCategoryName(value);
      if (checked.ok === false) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: CATEGORY_REPLIES.askName, prefix: checked.text };
      }
      draft.name = checked.name;
      draft.pendingField = draft.type === null ? 'type' : null;
    } else if (draft.pendingField === 'type') {
      const type = parseCategoryType(value);
      if (type === null) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: CATEGORY_REPLIES.askType };
      }
      draft.type = type;
      draft.pendingField = null;
    } else {
      return { status: 'ERROR', text: REPLIES.collectingReminder };
    }
    if (draft.name !== null && draft.type !== null && (await this.isCategoryNameTaken(userId, draft.name, draft.type))) {
      draft.name = null;
      draft.pendingField = 'name';
      return { status: 'ASK', outcome: ConversationOutcome.ERROR, question: CATEGORY_REPLIES.askName, prefix: CATEGORY_REPLIES.nameTaken };
    }
    return { status: 'UPDATED' };
  }

  /** Criar categoria: o FinanceCategoriesService grava (nome unico por tipo sob o indice); o texto sai do recibo. */
  private async applyCategoryCreate(userId: string, draft: CategoryCreateDraft): Promise<AppliedAction> {
    if (draft.name === null || draft.type === null) {
      throw new Error('rascunho de criar categoria incompleto');
    }
    const count = await this.prisma.financeCategory.count({ where: { userId } });
    const { name, type } = draft;
    const receipt = await this.guardCategoryWrite(() => this.financeCategories.create(userId, { name, color: nextCategoryColor(count), type }));
    return {
      text: `Categoria criada: ${receipt.name} (${categoryTypeLabel(draft.type)}). Ela já aparece quando você lançar um gasto ou receita. 🎉`,
      data: { categoryId: receipt.id },
      resultRef: receipt.id,
    };
  }

  /** 4xx do servico = recusa provada (nada gravado); qualquer outra falha pode ter gravado: resultado desconhecido, nao repete. */
  private async guardCategoryWrite<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) throw error;
      throw new CategoryWriteUncertainError();
    }
  }

  /** Editar (so o nome) ou excluir categoria propria: lista numerada, escolha pelo numero, confirmacao. */
  private async startCategoryChangeDraft(args: { input: ConversationInput; action: 'EDIT' | 'DELETE'; body: string }): Promise<ConversationReply> {
    const { input, action, body } = args;
    const { userId, receivedAt } = input;
    const intent = action === 'DELETE' ? 'delete_category' : 'edit_category';
    const own = await this.ownCategories(userId);
    if (own.length === 0) {
      await this.recordEvent(input, intent, ConversationOutcome.RECOGNIZED);
      return this.reply('INFO', 'IDLE', CATEGORY_REPLIES.none);
    }
    let pool = own;
    if (body.length > 0) {
      const matchedIds = new Set(matchCategory(body, own).map((category) => category.id));
      pool = own.filter((category) => matchedIds.has(category.id));
      if (pool.length === 0) {
        await this.recordEvent(input, intent, ConversationOutcome.RECOGNIZED);
        return this.reply('INFO', 'IDLE', REPLIES.noCategoryMatch(body));
      }
    }
    const draft: CategoryChangeDraft = {
      kind: 'CATEGORY_CHANGE',
      action,
      candidateIds: pool.slice(0, CATEGORY_PICK_MAX).map((category) => category.id),
      hasMore: pool.length > CATEGORY_PICK_MAX,
      targetId: null,
      targetName: null,
      newName: null,
      pendingField: 'category',
    };
    if (body.length > 0 && pool.length === 1) {
      draft.targetId = pool[0].id;
      draft.targetName = pool[0].name;
      draft.candidateIds = [];
      draft.pendingField = action === 'EDIT' ? 'name' : null;
    }
    return this.saveNewDraft({ input, intent, draft, today: await this.todayYmd(userId, receivedAt) });
  }

  /** Categorias do proprio usuario (nunca as do parceiro), despesas antes de receitas, por nome. */
  private async ownCategories(userId: string): Promise<Array<{ id: string; name: string; type: string }>> {
    const rows = await this.prisma.financeCategory.findMany({
      where: { userId },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
    // Despesas antes de receitas (o resto segue por nome).
    return [...rows].sort((a, b) => Number(a.type === 'INCOME') - Number(b.type === 'INCOME'));
  }

  private async categoryPickText(userId: string, draft: CategoryChangeDraft): Promise<string> {
    const rows = await this.prisma.financeCategory.findMany({ where: { userId, id: { in: draft.candidateIds } }, select: { id: true, name: true, type: true } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const lines = draft.candidateIds.flatMap((id, index) => {
      const row = byId.get(id);
      return row ? [categoryPickLine(index, row)] : [];
    });
    return [CATEGORY_REPLIES.pickHeader, ...lines, ...(draft.hasMore ? [CATEGORY_REPLIES.pickMoreInApp] : [])].join('\n');
  }

  private async answerCategoryChange(userId: string, draft: CategoryChangeDraft, value: string): Promise<PendingAnswer> {
    if (draft.pendingField === 'category') {
      const chosen = /^\d{1,2}$/.test(value) ? draft.candidateIds[Number(value) - 1] : undefined;
      if (chosen === undefined) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: await this.categoryPickText(userId, draft) };
      }
      const row = await this.prisma.financeCategory.findFirst({ where: { id: chosen, userId }, select: { id: true, name: true } });
      if (row === null) {
        return { status: 'ERROR', text: CATEGORY_REPLIES.gone };
      }
      draft.targetId = row.id;
      draft.targetName = row.name;
      draft.candidateIds = [];
      delete draft.hasMore;
      draft.pendingField = draft.action === 'EDIT' ? 'name' : null;
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'name' && draft.targetId !== null) {
      const target = await this.prisma.financeCategory.findFirst({ where: { id: draft.targetId, userId }, select: { id: true, name: true, type: true } });
      if (target === null) {
        return { status: 'ERROR', text: CATEGORY_REPLIES.gone };
      }
      const checked = checkCategoryName(value);
      if (checked.ok === false) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: CATEGORY_REPLIES.askNewName(target.name), prefix: checked.text };
      }
      if (normalize(checked.name) === normalize(target.name) && checked.name === target.name) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: CATEGORY_REPLIES.askNewName(target.name), prefix: CATEGORY_REPLIES.sameName };
      }
      if (await this.isCategoryNameTaken(userId, checked.name, target.type, target.id)) {
        return { status: 'ASK', outcome: ConversationOutcome.ERROR, question: CATEGORY_REPLIES.askNewName(target.name), prefix: CATEGORY_REPLIES.nameTaken };
      }
      draft.newName = checked.name;
      draft.pendingField = null;
      return { status: 'UPDATED' };
    }
    return { status: 'ERROR', text: REPLIES.collectingReminder };
  }

  private async categoryChangeDraftText(userId: string, draft: CategoryChangeDraft): Promise<string> {
    const target = draft.targetId === null ? null : await this.prisma.financeCategory.findFirst({ where: { id: draft.targetId, userId }, select: { name: true, sharedGroupOwnerId: true } });
    const name = target?.name ?? 'a escolher';
    if (draft.action === 'DELETE') {
      const shared = target?.sharedGroupOwnerId ? ` ${CATEGORY_REPLIES.sharedWarning}` : '';
      return `Excluir a categoria "${name}"? ${CATEGORY_REPLIES.deleteWarning}${shared}`;
    }
    return `Renomear "${name}" para "${draft.newName ?? 'a informar'}". Responda confirmar para salvar ou cancelar.`;
  }

  /** Aplica na confirmacao: relê a categoria com id + userId; sumida = recusa sem gravar. */
  private async applyCategoryChange(userId: string, draft: CategoryChangeDraft): Promise<AppliedAction> {
    const target = draft.targetId === null ? null : await this.prisma.financeCategory.findFirst({ where: { id: draft.targetId, userId }, select: { id: true, name: true } });
    if (target === null) {
      throw new NotFoundException(CATEGORY_REPLIES.gone);
    }
    if (draft.targetName !== null && target.name !== draft.targetName) {
      throw new ConflictException(CATEGORY_REPLIES.changedMeanwhile);
    }
    if (draft.action === 'DELETE') {
      await this.guardCategoryWrite(() => this.financeCategories.remove(userId, target.id));
      return { text: `Excluí a categoria "${target.name}". Os lançamentos dela ficaram sem categoria.`, data: { categoryId: target.id }, resultRef: target.id };
    }
    if (draft.newName === null) {
      throw new Error('rascunho de editar categoria sem nome novo');
    }
    const newName = draft.newName;
    await this.guardCategoryWrite(() => this.financeCategories.update(userId, target.id, { name: newName }));
    return { text: `Renomeei "${target.name}" para "${draft.newName}".`, data: { categoryId: target.id }, resultRef: target.id };
  }

  /** Botao do menu (limpar teto ou renomear) sem nome na frase: um cartao so segue direto; varios, lista numerada. */
  private async startCardPick(args: { input: ConversationInput; purpose: 'CLEAR_LIMIT' | 'SET_LIMIT' | 'RENAME' }): Promise<ConversationReply> {
    const { input, purpose } = args;
    const { userId, receivedAt } = input;
    const intent = purpose === 'RENAME' ? 'rename_card' : purpose === 'SET_LIMIT' ? 'set_credit_limit' : 'clear_credit_limit';
    const cards = await this.activeCards(userId);
    if (cards.length === 0) {
      await this.recordEvent(input, intent, ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', CARD_READ_REPLIES.none);
    }
    if (cards.length === 1 && purpose === 'CLEAR_LIMIT') {
      return this.startCreditLimitClearDraft({ input, body: cards[0].name });
    }
    if (cards.length === 1 && purpose === 'SET_LIMIT') {
      return this.startCreditLimitDraft({ input, body: '' });
    }
    const single = cards.length === 1 ? cards[0] : null;
    const draft: CardPickDraft = {
      kind: 'CARD_PICK',
      purpose,
      cardIds: single ? [] : cards.map((card) => card.id),
      cardId: single?.id ?? null,
      cardName: single?.name ?? null,
      pendingField: single ? 'name' : 'card',
    };
    return this.saveNewDraft({ input, intent, draft, today: await this.todayYmd(userId, receivedAt) });
  }

  private async cardPickText(userId: string, draft: CardPickDraft): Promise<string> {
    const active = await this.activeCards(userId);
    const lines = draft.cardIds.flatMap((id, index) => {
      const card = active.find((candidate) => candidate.id === id);
      return card ? [cardPickLine(index, card)] : [];
    });
    return [CARD_WRITE_REPLIES.pickHeader, ...lines].join('\n');
  }

  /** Escolha do cartao (numero) e, para renomear, o novo nome; ao final o rascunho vira o de sempre, no mesmo lugar. */
  private async answerCardPick(userId: string, draft: CardPickDraft, value: string): Promise<PendingAnswer> {
    const active = await this.activeCards(userId);
    if (draft.pendingField === 'card') {
      const chosenId = /^\d{1,2}$/.test(value) ? draft.cardIds[Number(value) - 1] : undefined;
      if (chosenId === undefined) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: await this.cardPickText(userId, draft) };
      }
      const card = active.find((candidate) => candidate.id === chosenId);
      if (!card) {
        return { status: 'ERROR', text: CARD_WRITE_REPLIES.cardGone };
      }
      if (draft.purpose === 'RENAME') {
        draft.cardId = card.id;
        draft.cardName = card.name;
        draft.cardIds = [];
        draft.pendingField = 'name';
        return { status: 'UPDATED' };
      }
      if (draft.purpose === 'SET_LIMIT') {
        const setting = await this.prepareSetLimitDraft(userId, card);
        if ('errorText' in setting) return { status: 'ERROR', text: setting.errorText };
        replaceDraft(draft, setting.draft);
        return { status: 'UPDATED' };
      }
      const prepared = await this.prepareClearLimitDraft(userId, card);
      if ('errorText' in prepared) return { status: 'ERROR', text: prepared.errorText };
      if ('alreadyClear' in prepared) return { status: 'ERROR', text: CARD_WRITE_REPLIES.alreadyClear };
      replaceDraft(draft, prepared.draft);
      return { status: 'UPDATED' };
    }
    const card = active.find((candidate) => candidate.id === draft.cardId);
    if (!card) {
      return { status: 'ERROR', text: CARD_WRITE_REPLIES.cardGone };
    }
    const newName = value.trim().replace(/\s+/g, ' ');
    const ask = (prefix: string): PendingAnswer => ({ status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: CARD_WRITE_REPLIES.askNewName(card.name), prefix });
    if (newName.length < CARD_NAME_MIN || newName.length > CARD_NAME_MAX) return ask(CARD_WRITE_REPLIES.nameLength);
    if (card.name === newName) return ask(CARD_WRITE_REPLIES.sameName);
    if (nameTakenBy(active, newName, card.id)) return ask(CARD_WRITE_REPLIES.nameTaken);
    const renamed: CardRenameDraft = { kind: 'CARD_RENAME', cardId: card.id, currentName: card.name, newName, pendingField: null };
    replaceDraft(draft, renamed);
    return { status: 'UPDATED' };
  }

  /**
   * Criar cartao (9b-3b): nome, teto de 10 ativos e nome unico conferidos antes do rascunho; sem rascunho nada e gravado.
   * O dia de fechamento vem na frase ou e perguntado; o vencimento so vem na frase.
   */
  private async startCardCreateDraft(args: { input: ConversationInput; body: string }): Promise<ConversationReply> {
    const { input, body } = args;
    const { userId, receivedAt } = input;

    const cards = await this.activeCards(userId);
    if (cards.length >= MAX_ACTIVE_CARDS_PER_USER) {
      await this.recordEvent(input, 'create_card', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', CARD_WRITE_REPLIES.createLimit(MAX_ACTIVE_CARDS_PER_USER));
    }
    if (body.trim() === '') {
      // Botao do menu: sem nome na frase, o motor pergunta o nome e depois o dia de fechamento.
      const empty: CardCreateDraft = { kind: 'CARD_CREATE', name: null, closingDay: null, dueDay: null, pendingField: 'name' };
      return this.saveNewDraft({ input, intent: 'create_card', draft: empty, today: await this.todayYmd(userId, receivedAt) });
    }
    const parsed = parseCardCreate(body);
    if (parsed.ok === false) {
      await this.recordEvent(input, 'create_card', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', parsed.text);
    }
    if (nameTakenBy(cards, parsed.name, '')) {
      await this.recordEvent(input, 'create_card', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', CARD_WRITE_REPLIES.createNameTaken);
    }
    const draft: CardCreateDraft = {
      kind: 'CARD_CREATE',
      name: parsed.name,
      closingDay: parsed.closingDay,
      dueDay: parsed.dueDay,
      pendingField: parsed.closingDay === null ? 'closingDay' : null,
    };
    return this.saveNewDraft({ input, intent: 'create_card', draft, today: await this.todayYmd(userId, receivedAt) });
  }

  /** Criar cartao: o CreditCardsService confere teto e nome unico sob o lock; o texto sai do recibo. */
  private async applyCardCreate(userId: string, draft: CardCreateDraft): Promise<AppliedAction> {
    if (draft.closingDay === null || draft.name === null) {
      throw new Error('rascunho de criar cartao incompleto');
    }
    const name = draft.name;
    // Confere de novo o nome parecido antes de gravar (a API so barra o igual sem caixa). Fora do lock; a janela e minima.
    const cards = await this.activeCards(userId);
    if (nameTakenBy(cards, name, '')) {
      throw new ConflictException('Ja existe um cartao com este nome.');
    }
    const receipt = await this.creditCards.create(userId, {
      name,
      closingDay: draft.closingDay,
      dueDay: draft.dueDay,
    });
    return {
      text: cardCreatedText({ name: receipt.name, closingDay: receipt.closingDay, dueDay: receipt.dueDay }),
      data: { cardId: receipt.id },
      resultRef: receipt.id,
      refreshPending: receipt.refreshPending,
    };
  }

  /** Criar cartao: a unica pergunta e o dia de fechamento (1 a 31); resposta invalida repete a pergunta sem sair do rascunho. */
  private async answerCardCreate(userId: string, draft: CardCreateDraft, value: string): Promise<PendingAnswer> {
    if (draft.pendingField === 'name') {
      const name = value.trim().replace(/\s+/g, ' ');
      if (name.length < CARD_NAME_MIN || name.length > CARD_NAME_MAX) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: CARD_WRITE_REPLIES.askName, prefix: CARD_WRITE_REPLIES.nameLength };
      }
      const cards = await this.activeCards(userId);
      if (cards.length >= MAX_ACTIVE_CARDS_PER_USER) {
        return { status: 'ERROR', text: CARD_WRITE_REPLIES.createLimit(MAX_ACTIVE_CARDS_PER_USER) };
      }
      if (nameTakenBy(cards, name, '')) {
        return { status: 'ASK', outcome: ConversationOutcome.ERROR, question: CARD_WRITE_REPLIES.askName, prefix: CARD_WRITE_REPLIES.createNameTaken };
      }
      draft.name = name;
      draft.pendingField = draft.closingDay === null ? 'closingDay' : null;
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'closingDay') {
      const day = parseClosingDayAnswer(value);
      if (day === null) {
        return {
          status: 'ASK',
          outcome: ConversationOutcome.UNRECOGNIZED,
          question: CARD_WRITE_REPLIES.askClosingDay(draft.name ?? ''),
          prefix: CARD_WRITE_REPLIES.closingDayInvalid,
        };
      }
      draft.closingDay = day;
      draft.pendingField = null;
      return { status: 'UPDATED' };
    }
    return { status: 'ERROR', text: REPLIES.collectingReminder };
  }

  /**
   * Renomear cartao (9b-3, secao 7): cartao ativo achado pelo nome (busca do 8d). Termo vazio, ambiguo, inexistente,
   * nome igual ao atual ou nome ja usado por outro cartao ativo recusa sem rascunho. Na confirmacao o servico confere de novo.
   */
  private async startCardRenameDraft(args: { input: ConversationInput; body: string }): Promise<ConversationReply> {
    const { input, body } = args;
    const { userId, receivedAt } = input;

    const parsed = parseCardRename(body);
    if (parsed.ok === false) {
      await this.recordEvent(input, 'rename_card', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', parsed.text);
    }
    const cards = await this.activeCards(userId);
    if (cards.length === 0) {
      await this.recordEvent(input, 'rename_card', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', CARD_READ_REPLIES.none);
    }
    const hits = matchCardsByTerm(cards, parsed.term);
    if (hits.length === 0 || hits.length > 1) {
      await this.recordEvent(input, 'rename_card', ConversationOutcome.ERROR);
      const names = cards.map((card) => card.name);
      const text =
        hits.length === 0
          ? CARD_WRITE_REPLIES.notFound(parsed.term, names)
          : CARD_WRITE_REPLIES.ambiguous(parsed.term, hits.map((card) => card.name));
      return this.reply('ERROR', 'IDLE', text);
    }
    const [card] = hits;
    if (card.name === parsed.newName) {
      await this.recordEvent(input, 'rename_card', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', CARD_WRITE_REPLIES.sameName);
    }
    if (nameTakenBy(cards, parsed.newName, card.id)) {
      await this.recordEvent(input, 'rename_card', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', CARD_WRITE_REPLIES.nameTaken);
    }
    const draft: CardRenameDraft = {
      kind: 'CARD_RENAME',
      cardId: card.id,
      currentName: card.name,
      newName: parsed.newName,
      pendingField: null,
    };
    return this.saveNewDraft({ input, intent: 'rename_card', draft, today: await this.todayYmd(userId, receivedAt) });
  }

  /** Renomear cartao: o CreditCardsService confere nome unico e cartao ativo sob o lock; o texto sai do recibo. */
  private async applyCardRename(userId: string, draft: CardRenameDraft): Promise<AppliedAction> {
    if (draft.cardId === null) {
      throw new Error('rascunho de renomear cartao incompleto');
    }
    // Confere de novo o nome parecido (sem acento/caixa) antes de gravar: a API so barra o igual sem caixa. Fora do lock; a janela e minima.
    const cards = await this.activeCards(userId);
    if (nameTakenBy(cards, draft.newName, draft.cardId)) {
      throw new ConflictException('Ja existe um cartao com este nome.');
    }
    const receipt = await this.creditCards.update(userId, draft.cardId, { name: draft.newName });
    return {
      text: cardRenamedText({ from: draft.currentName, to: receipt.name }),
      data: { cardId: receipt.id },
      resultRef: receipt.id,
      refreshPending: receipt.refreshPending,
    };
  }

  /** Cartao do chat pelo nome (8d). Termo vazio = null (= cartao padrao, resolvido por quem chama). */
  private async resolveChatCard(userId: string, term: string): Promise<{ card: ChatCard | null } | { errorText: string }> {
    if (term === '') return { card: null };
    const cards = await this.prisma.creditCard.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });
    const hits = matchCardsByTerm(cards, term);
    if (hits.length === 0) return { errorText: CL_REPLIES.cardNotFound(term, cards.map((row) => row.name)) };
    if (hits.length > 1) return { errorText: CL_REPLIES.cardAmbiguous(term, hits.map((row) => row.name)) };
    return { card: hits[0] };
  }

  /**
   * Criar conta fixa (contrato 3b2b, secao 4). Plano checado ao abrir; despesa, sem categoria nem
   * pagamento. Frequência ausente vira mensal. Data passada ou longe demais recusa sem rascunho.
   */
  private async startRecurringDraft(args: { input: ConversationInput; body: string }): Promise<ConversationReply> {
    const { input, body } = args;
    const { userId, receivedAt } = input;
    const refusal = await this.refuseIfPlanFull(userId, input, 'recurringTransactions', 'create_recurring');
    if (refusal) return refusal;

    const parsed = parseRecurringBody(body);
    if (parsed.ok === false) {
      await this.recordEvent(input, 'create_recurring', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', bodyErrorText(parsed.reason));
    }
    const { description, amountCents, frequency, dueText } = parsed.value;
    const today = await this.todayYmd(userId, receivedAt);
    const dueError = description !== null && description.length > DESCRIPTION_MAX
      ? REPLIES.descriptionTooLong
      : null;
    const due = openingDue(dueText, today);
    if (dueError !== null || due.error !== null) {
      await this.recordEvent(input, 'create_recurring', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', dueError ?? due.error ?? REPLIES.collectingReminder);
    }

    const draft: RecurringDraft = {
      kind: 'RECURRING',
      description,
      amountCents,
      frequency: frequency ?? DEFAULT_RECURRING_FREQUENCY,
      firstDueDate: due.ymd,
      pendingField: nextRecurringPending({ description, amountCents, firstDueDate: due.ymd }),
    };
    return this.saveNewDraft({ input, intent: 'create_recurring', draft, today });
  }

  /**
   * Criar compra parcelada. O valor é sempre o total. Quantidade de 2 a 60 e parcela não menor
   * que R$ 0,01 (regra do serviço, conferida também aqui para não abrir rascunho que será recusado).
   */
  private async startInstallmentDraft(args: { input: ConversationInput; body: string }): Promise<ConversationReply> {
    const { input, body } = args;
    const { userId, receivedAt } = input;
    const refusal = await this.refuseIfPlanFull(userId, input, 'installmentPurchases', 'create_installment');
    if (refusal) return refusal;

    const parsed = parseInstallmentBody(body);
    if (parsed.ok === false) {
      await this.recordEvent(input, 'create_installment', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', bodyErrorText(parsed.reason));
    }
    const { description, totalCents, installmentsTotal, dueText } = parsed.value;
    const today = await this.todayYmd(userId, receivedAt);
    const descriptionError = description !== null && description.length > DESCRIPTION_MAX
      ? REPLIES.descriptionTooLong
      : null;
    const splitError = totalCents !== null && installmentsTotal !== null &&
      splitInstallments(totalCents, installmentsTotal) === null
      ? REPLIES.installmentTooSmall
      : null;
    const due = openingDue(dueText, today);
    const error = descriptionError ?? splitError ?? due.error;
    if (error !== null) {
      await this.recordEvent(input, 'create_installment', ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', error);
    }

    const draft: InstallmentDraft = {
      kind: 'INSTALLMENT',
      toneSeed: input.messageId,
      description,
      totalCents,
      installmentsTotal,
      firstDueDate: due.ymd,
      pendingField: nextInstallmentPending({ description, totalCents, installmentsTotal, firstDueDate: due.ymd }),
    };
    return this.saveNewDraft({ input, intent: 'create_installment', draft, today });
  }

  /** Recusa ao abrir por limite do plano: sem rascunho, com a mensagem do domínio (contrato 6). */
  private async refuseIfPlanFull(
    userId: string,
    input: ConversationInput,
    resource: 'recurringTransactions' | 'installmentPurchases',
    intent: string,
  ): Promise<ConversationReply | null> {
    try {
      await this.entitlements.assertCanCreate(userId, resource);
      return null;
    } catch (error) {
      if (error instanceof PlanLimitException) {
        await this.recordEvent(input, intent, ConversationOutcome.ERROR);
        return this.reply('ERROR', 'IDLE', error.message);
      }
      throw error;
    }
  }

  private async isEnvelopeNameTaken(userId: string, name: string): Promise<boolean> {
    const found = await this.prisma.envelope.findFirst({ where: { userId, name }, select: { id: true } });
    return found !== null;
  }

  /** Editar/apagar: busca e abre a lista numerada, ou pergunta qual lançamento (contrato 8a, secoes 3 a 5). */
  private async startTransactionChange(args: {
    input: ConversationInput;
    action: 'EDIT' | 'DELETE';
    body: string;
  }): Promise<ConversationReply> {
    const { input, action, body } = args;
    const intent = action === 'DELETE' ? 'delete_transaction' : 'edit_transaction';
    const draft: TransactionChangeDraft = {
      kind: 'TRANSACTION_CHANGE',
      action,
      candidateIds: [],
      targetId: null,
      targetUpdatedAt: null,
      changes: {},
      pendingField: 'transaction',
    };
    if (body.length > 0) {
      const found = await this.searchTransactions(input.userId, body, input.receivedAt);
      if (found.status !== 'FOUND') {
        await this.recordEvent(input, intent, ConversationOutcome.RECOGNIZED);
        return this.reply('INFO', 'IDLE', found.status === 'NONE' ? TX_REPLIES.notFound : TX_REPLIES.onlyNonEditable);
      }
      draft.candidateIds = found.ids;
    } else {
      const page = await this.recentTransactionsPage(input.userId, 0);
      if (page.ids.length === 0) {
        await this.recordEvent(input, intent, ConversationOutcome.RECOGNIZED);
        return this.reply('INFO', 'IDLE', TX_REPLIES.emptyList);
      }
      draft.candidateIds = page.ids;
      draft.listOffset = 0;
      draft.hasMore = page.hasMore;
    }
    const today = await this.todayYmd(input.userId, input.receivedAt);
    return this.saveNewDraft({ input, intent, draft, today });
  }

  /**
   * Busca de lançamentos do usuário (últimos 180 dias). Só elegíveis entram na lista, até 5, na ordem do banco.
   * Carrega a janela inteira e filtra em memória: acento e caixa não são feitos no banco (ver resultado-8a1.md).
   */
  private async searchTransactions(userId: string, body: string, now: Date): Promise<TxSearch> {
    const search = parseSearch(body);
    if (search.term.length === 0 && search.amountCents === null) {
      return { status: 'NONE' };
    }
    const rows = await this.prisma.transaction.findMany({
      where: { userId, date: { gte: new Date(now.getTime() - TX_CHANGE_WINDOW_DAYS * TX_DAY_MS) } },
      select: TX_SELECT,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: TX_SEARCH_LIMIT,
    });
    const matched = rows.map(toTxCandidate).filter((candidate) => matchesSearch(candidate, search));
    if (matched.length === 0) {
      return { status: 'NONE' };
    }
    const editable = matched.filter((candidate) => candidate.eligible).slice(0, TX_CHANGE_MAX_CANDIDATES);
    if (editable.length === 0) {
      return { status: 'ONLY_NON_EDITABLE' };
    }
    return { status: 'FOUND', ids: editable.map((candidate) => candidate.id) };
  }

  /** Pagina dos lancamentos mais recentes que se pode mudar por conversa (so manuais, sem transferencia). */
  private async recentTransactionsPage(userId: string, offset: number): Promise<{ ids: string[]; hasMore: boolean }> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: { not: TransactionType.TRANSFER },
        recurringTransactionId: null,
        installmentPurchaseId: null,
        linkedGoalId: null,
        receiptScan: null,
      },
      select: { id: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: TX_LIST_PAGE_SIZE + 1,
    });
    return { ids: rows.slice(0, TX_LIST_PAGE_SIZE).map((row) => row.id), hasMore: rows.length > TX_LIST_PAGE_SIZE };
  }

  /** Lançamento do usuário pelo id (id + userId, nunca só o id). */
  private async loadTxCandidate(userId: string, id: string): Promise<TxCandidate | null> {
    const row = await this.prisma.transaction.findFirst({ where: { id, userId }, select: TX_SELECT });
    return row ? toTxCandidate(row) : null;
  }

  /** Lista numerada dos candidatos ainda existentes (a numeração segue a ordem original). */
  private async transactionListText(userId: string, draft: TransactionChangeDraft): Promise<string> {
    const ids = draft.candidateIds;
    const compact = draft.listOffset !== undefined;
    const rows = await this.prisma.transaction.findMany({ where: { userId, id: { in: ids } }, select: TX_SELECT });
    const byId = new Map(rows.map((row) => [row.id, toTxCandidate(row)]));
    const lines = ids
      .map((id, index) => {
        const candidate = byId.get(id);
        if (!candidate?.eligible) return null;
        return compact ? formatCompactLine(index, candidate) : formatCandidateLine(index, candidate);
      })
      .filter((line): line is string => line !== null);
    return [TX_REPLIES.pickHeader, ...lines, ...(draft.hasMore ? [TX_REPLIES.moreHint] : [])].join('\n');
  }

  /** "mais": mostra os proximos lancamentos; sem mais, avisa e repete a pagina atual. */
  private async nextTransactionsPage(userId: string, draft: TransactionChangeDraft): Promise<PendingAnswer> {
    if (!draft.hasMore) {
      const list = await this.transactionListText(userId, draft);
      return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: `${TX_REPLIES.noMore}\n${list}` };
    }
    const offset = (draft.listOffset ?? 0) + TX_LIST_PAGE_SIZE;
    const page = await this.recentTransactionsPage(userId, offset);
    if (page.ids.length === 0) {
      draft.hasMore = false;
      return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: `${TX_REPLIES.noMore}\n${await this.transactionListText(userId, draft)}` };
    }
    draft.candidateIds = page.ids;
    draft.listOffset = offset;
    draft.hasMore = page.hasMore;
    return { status: 'UPDATED' };
  }

  /** Resposta à lista: número escolhe; sem candidatos, o texto é a busca. Mudança de campo: etapa de editar. */
  private async answerTransactionChange(
    userId: string,
    draft: TransactionChangeDraft,
    value: string,
    today: string,
  ): Promise<PendingAnswer> {
    if (draft.pendingField === 'transaction') {
      if (draft.candidateIds.length === 0) {
        // Comando sem termo ("apagar"): o texto seguinte é a busca.
        const found = await this.searchTransactions(userId, value, new Date());
        if (found.status !== 'FOUND') {
          return { status: 'ERROR', text: found.status === 'NONE' ? TX_REPLIES.notFound : TX_REPLIES.onlyNonEditable };
        }
        draft.candidateIds = found.ids;
        return { status: 'UPDATED' };
      }
      if (draft.listOffset !== undefined && normalize(value) === 'mais') {
        return this.nextTransactionsPage(userId, draft);
      }
      const chosen = /^\d{1,2}$/.test(value) ? draft.candidateIds[Number(value) - 1] : undefined;
      if (chosen === undefined) {
        return {
          status: 'ASK',
          outcome: ConversationOutcome.UNRECOGNIZED,
          question: await this.transactionListText(userId, draft),
        };
      }
      const row = await this.loadTxCandidate(userId, chosen);
      if (row === null) {
        return { status: 'ERROR', text: TX_REPLIES.gone };
      }
      if (!row.eligible) {
        // Conta fixa, parcelado, meta ou nota: nunca se muda por conversa (contrato 8a, secao 3).
        return { status: 'ERROR', text: TX_REPLIES.onlyNonEditable };
      }
      draft.targetId = row.id;
      draft.targetUpdatedAt = row.updatedAt.toISOString();
      draft.candidateIds = [];
      delete draft.listOffset;
      delete draft.hasMore;
      draft.pendingField = draft.action === 'EDIT' ? 'change' : null;
      return { status: 'UPDATED' };
    }
    // Editar: uma mudança por mensagem; a prévia mostra antes -> depois (contrato 8a, secao 5).
    if (draft.targetId === null) {
      return { status: 'ERROR', text: TX_REPLIES.gone };
    }
    const parsed = parseChange(value, today, amountErrorText);
    if (parsed.ok === false) {
      return { status: 'ERROR', text: parsed.text };
    }
    if (parsed.field === 'amountCents') {
      draft.changes.amountCents = parsed.cents;
    } else if (parsed.field === 'description') {
      draft.changes.description = parsed.text;
    } else if (parsed.field === 'date') {
      draft.changes.date = parsed.ymd;
    } else {
      const target = await this.loadTxCandidate(userId, draft.targetId);
      if (target === null) {
        return { status: 'ERROR', text: TX_REPLIES.gone };
      }
      // Só categorias do mesmo tipo (receita/despesa) do lançamento, como no criar.
      const categories = await this.prisma.financeCategory.findMany({
        where: { userId, type: target.type },
        select: { id: true, name: true },
      });
      const query = normalize(parsed.query);
      const exact = categories.filter((category) => normalize(category.name) === query);
      const pool = exact.length > 0 ? exact : categories.filter((category) => normalize(category.name).includes(query));
      if (pool.length === 0) {
        return { status: 'ERROR', text: TX_REPLIES.categoryNotFound };
      }
      if (pool.length > 1) {
        return { status: 'ERROR', text: TX_REPLIES.categoryAmbiguous };
      }
      draft.changes.categoryId = pool[0].id;
    }
    draft.pendingField = null;
    return { status: 'UPDATED' };
  }

  /** Prévia do rascunho de editar/apagar. Confirmação de apagar usa a palavra "apagar" (contrato 8a, secao 4). */
  private async transactionChangeText(userId: string, draft: TransactionChangeDraft): Promise<string> {
    const target = draft.targetId === null ? null : await this.loadTxCandidate(userId, draft.targetId);
    if (target === null) {
      return TX_REPLIES.gone;
    }
    if (draft.action === 'DELETE') {
      return [`Apagar: ${describeCandidate(target)}.`, TX_REPLIES.deleteWarning, TX_REPLIES.deleteNeedsWord].join('\n');
    }
    const lines = await this.changeDiffLines(userId, target, draft.changes);
    if (lines.length === 0) {
      return TX_REPLIES.nothingToChange;
    }
    return [`Editar: ${describeCandidate(target)}.`, ...lines, TX_REPLIES.editConfirm].join('\n');
  }

  /** Linhas "antes -> depois" só dos campos que mudam de fato. */
  private async changeDiffLines(
    userId: string,
    target: TxCandidate,
    changes: TransactionChangeDraft['changes'],
  ): Promise<string[]> {
    const lines: string[] = [];
    if (changes.amountCents !== undefined && changes.amountCents !== target.amountCents) {
      lines.push(`Valor: ${formatCents(target.amountCents)} -> ${formatCents(changes.amountCents)}`);
    }
    if (changes.description !== undefined && changes.description !== target.description) {
      lines.push(`Descrição: ${target.description} -> ${changes.description}`);
    }
    if (changes.categoryId !== undefined && changes.categoryId !== target.categoryId) {
      const after = changes.categoryId === null ? null : (await this.categoryNames(userId, [changes.categoryId]))[0] ?? null;
      lines.push(`Categoria: ${target.categoryName ?? 'sem categoria'} -> ${after ?? 'sem categoria'}`);
    }
    if (changes.date !== undefined && changes.date !== target.date) {
      lines.push(`Data: ${formatDayMonth(target.date)} -> ${formatDayMonth(changes.date)}`);
    }
    return lines;
  }

  /** Linhas do cartão de editar: valor atual e novo por campo que muda de fato (sem ids). */
  private async changeDiffRows(
    userId: string,
    target: TxCandidate,
    changes: TransactionChangeDraft['changes'],
  ): Promise<DraftView['rows']> {
    const rows: DraftView['rows'] = [];
    if (changes.amountCents !== undefined && changes.amountCents !== target.amountCents) {
      rows.push({ label: 'Valor', value: `${formatBrl(target.amountCents)} → ${formatBrl(changes.amountCents)}` });
    }
    if (changes.description !== undefined && changes.description !== target.description) {
      rows.push({ label: 'Descrição', value: `${target.description} → ${changes.description}` });
    }
    if (changes.categoryId !== undefined && changes.categoryId !== target.categoryId) {
      const after = changes.categoryId === null ? null : (await this.categoryNames(userId, [changes.categoryId]))[0] || null;
      rows.push({ label: 'Categoria', value: `${target.categoryName ?? 'sem categoria'} → ${after ?? 'sem categoria'}` });
    }
    if (changes.date !== undefined && changes.date !== target.date) {
      rows.push({ label: 'Data', value: `${formatDmy(target.date)} → ${formatDmy(changes.date)}` });
    }
    return rows;
  }

  private async saveNewDraft(args: {
    input: ConversationInput;
    intent: string;
    draft: SessionDraft;
    today: string;
  }): Promise<ConversationReply> {
    const { input, intent, draft, today } = args;
    const { userId, channel, receivedAt } = input;
    const state = draft.pendingField ? ConversationState.COLLECTING_FIELDS : ConversationState.AWAITING_CONFIRMATION;

    let session: SessionRow;
    try {
      session = await this.prisma.conversationSession.create({
        data: {
          userId,
          channel,
          state,
          intent,
          draft: draft as unknown as Prisma.InputJsonValue,
          version: 1,
          expiresAt: new Date(receivedAt.getTime() + ttlFor(state)),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return this.reply('ERROR', this.stateView(await this.loadSession(userId, channel)), REPLIES.collectingReminder);
      }
      throw error;
    }

    await this.recordEvent(input, intent, ConversationOutcome.RECOGNIZED);
    return this.draftReply(session, today);
  }

  // ---------- com sessao ativa ----------

  private async handleWithSession(args: {
    input: ConversationInput;
    session: SessionRow;
    text: string;
  }): Promise<ConversationReply> {
    const { input, session, text } = args;
    const { userId } = input;
    const words = normalize(text);
    const intent = await this.resolveLooseCardRead(userId, text.length > 0 ? matchIntent(text) : null);
    const awaiting = session.state === ConversationState.AWAITING_CONFIRMATION;

    if (exitKindOf(text)) {
      return this.leaveDraft(userId, session, input.messageId, input.receivedAt);
    }
    const deleteAwaiting = awaiting && isDeleteChange(session.draft);
    const clearAwaiting = awaiting && isClearLimitDraft(session.draft);
    if ((deleteAwaiting || clearAwaiting) && CONFIRM_WORDS.has(words)) {
      // Apagar so vale com a palavra "apagar"; limpar teto, com "limpar" (contratos 8a sec.4 e 8d D3): confirmar/sim/ok nao gravam.
      await this.recordEvent(input, session.intent, ConversationOutcome.UNRECOGNIZED);
      return this.draftReply(session, await this.todayYmd(userId, input.receivedAt), {
        prefix: deleteAwaiting ? TX_REPLIES.deleteNeedsWord : CL_REPLIES.clearNeedsWord,
      });
    }
    // Editar sem nenhuma mudança: confirmar não grava (contrato 8a, secao 5; vale tambem para meta e reserva, 8b).
    const editNothing = isEditWithoutChanges(session.draft);
    if (editNothing && CONFIRM_WORDS.has(words)) {
      await this.recordEvent(input, session.intent, ConversationOutcome.UNRECOGNIZED);
      return this.draftReply(session, await this.todayYmd(userId, input.receivedAt), { prefix: TX_REPLIES.nothingToChange });
    }
    if (CONFIRM_WORDS.has(words) || (deleteAwaiting && words === 'apagar') || (clearAwaiting && words === 'limpar')) {
      if (awaiting) {
        // Trava de escrita por canal (contratos 8 e 10/D3): o app continua gravando normalmente.
        // O texto nao cita canal, entao o do WhatsApp serve aos dois.
        const writesOff =
          (input.channel === 'WHATSAPP' && !this.configService.get<boolean>('whatsapp.writesEnabled')) ||
          (input.channel === 'TELEGRAM' && !this.configService.get<boolean>('telegram.writesEnabled'));
        if (writesOff) {
          await this.recordEvent(input, session.intent, ConversationOutcome.RECOGNIZED);
          return this.reply('INFO', this.stateView(session), REPLIES.whatsappWritesOff);
        }
        return this.applyDraft({ userId, session, messageId: input.messageId, now: input.receivedAt, channel: input.channel });
      }
      // "ok" fora de AWAITING_CONFIRMATION não faz nada (contrato secao 6).
      await this.recordEvent(input, session.intent, ConversationOutcome.UNRECOGNIZED);
      return this.draftReply(session, await this.todayYmd(userId, input.receivedAt), { prefix: REPLIES.collectingReminder });
    }
    const pendingDraft = session.draft as unknown as SessionDraft;
    if (isTransactionChangeDraft(pendingDraft) && pendingDraft.pendingField === 'transaction' && !awaiting && (intent === null || /^\d/.test(text))) {
      // Lista numerada: número escolhe o lançamento; texto vira nova busca (contrato 8a, secao 3). Comando conhecido
      // (leitura, ajuda, novo comando de escrita) segue a regra do motor: leitura responde, escrita lembra o rascunho.
      return this.fillPendingField({ input, session, text });
    }
    if (isTransactionChangeDraft(pendingDraft) && pendingDraft.action === 'EDIT' && pendingDraft.pendingField !== 'transaction' && !intent) {
      // Edição: "valor 45", "descrição padaria" etc. (também depois da prévia, para mudar mais de um campo).
      return this.fillPendingField({ input, session, text });
    }
    if (input.viaMenu !== true && isCategoryCreateAnswer(pendingDraft, text, intent) && !awaiting) {
      return this.fillPendingField({ input, session, text });
    }
    if (isCategoryChangeDraft(pendingDraft) && pendingDraft.pendingField === 'category' && !awaiting && (intent === null || /^\d/.test(text))) {
      return this.fillPendingField({ input, session, text });
    }
    if (isTargetChangeDraft(pendingDraft) && pendingDraft.pendingField === 'targetChoice' && !awaiting && (intent === null || /^\d/.test(text))) {
      // Meta/reserva: número escolhe; texto vira busca (contrato 8b, secao 3). Comando conhecido segue a regra do motor.
      return this.fillPendingField({ input, session, text });
    }
    if (isTargetChangeDraft(pendingDraft) && pendingDraft.action === 'EDIT' && pendingDraft.pendingField !== 'targetChoice' && !intent) {
      // "título viagem", "valor 800", "sem alvo", "prazo 12/2026" (meta) ou "nome x", "valor mensal 150" (reserva).
      return this.fillPendingField({ input, session, text });
    }
    // Texto que começa com número é a resposta pedida (nome, descrição, quantidade, data), não um comando (contrato 4).
    if (!awaiting && startsWithNumericAnswer(pendingDraft) && /^\d/.test(text)) {
      return this.fillPendingField({ input, session, text });
    }
    if (!awaiting && (isOptionNumber(words, pendingDraft) || isAmountAnswer(text, pendingDraft))) {
      // "1".."5" respondem a pergunta de categoria ou de meta, e um número responde "Quanto foi?"; sem isso o matcher leria como novo gasto.
      return this.fillPendingField({ input, session, text });
    }
    if (intent && isReadIntent(intent)) {
      // Leitura não mexe no rascunho: a sessão segue como estava.
      return this.runRead(input, intent, this.stateView(session));
    }
    if (intent && intent.intent === 'help') {
      await this.recordEvent(input, 'help', ConversationOutcome.RECOGNIZED);
      return this.reply('HELP', this.stateView(session), REPLIES.help);
    }
    if (intent && intent.intent === 'import_receipt') {
      // Como a ajuda: o rascunho em andamento segue como estava.
      return this.importReceiptReply(input, this.stateView(session));
    }
    if (awaiting) {
      await this.recordEvent(input, session.intent, ConversationOutcome.UNRECOGNIZED);
      return this.draftReply(session, await this.todayYmd(userId, input.receivedAt), { prefix: REPLIES.confirmReminder });
    }
    if (intent && (intent.intent === 'create_expense' || intent.intent === 'create_income') && intent.missingAmount !== true && isAwaitingFirstAmount(pendingDraft)) {
      // Rascunho vazio (so esperava o valor, ex.: botao Lancar despesa) e a frase ja traz valor: a frase vira o lancamento.
      await this.prisma.conversationSession.deleteMany({ where: { id: session.id, userId } });
      return this.startDraft({ input, intent });
    }
    if (intent) {
      // Comando de escrita com rascunho em coleta: não substitui o rascunho em silencio.
      await this.recordEvent(input, session.intent, ConversationOutcome.UNRECOGNIZED);
      return this.draftReply(session, await this.todayYmd(userId, input.receivedAt), { prefix: REPLIES.collectingReminder });
    }
    return this.fillPendingField({ input, session, text });
  }

  /**
   * Preenche o campo que falta. A resposta é tratada pelo tipo do rascunho; o salvamento e o
   * controle de versão são iguais para os três tipos.
   */
  private async fillPendingField(args: {
    input: ConversationInput;
    session: SessionRow;
    text: string;
  }): Promise<ConversationReply> {
    const { input, session, text } = args;
    const { userId, receivedAt } = input;
    const draft = session.draft as unknown as SessionDraft;
    const today = await this.todayYmd(userId, receivedAt);

    const answer = await this.answerPending(userId, draft, text.trim(), today);
    if (answer.status === 'ERROR') {
      await this.recordEvent(input, session.intent, ConversationOutcome.ERROR);
      return this.reply('ERROR', this.stateView(session), answer.text);
    }
    if (answer.status === 'ASK') {
      await this.recordEvent(input, session.intent, answer.outcome);
      return this.draftReply(session, today, { question: answer.question, prefix: answer.prefix });
    }

    // Campo respondido: o motivo da revisão anterior já foi atendido e não pode ficar no cartão novo.
    delete (draft as { reviewReason?: string }).reviewReason;
    if (draftKind(draft) === 'TRANSACTION') settleCardChoice(draft as ExpenseOrIncomeDraft);
    const nextState = draft.pendingField ? ConversationState.COLLECTING_FIELDS : ConversationState.AWAITING_CONFIRMATION;
    const updated = await this.prisma.conversationSession.updateMany({
      where: { id: session.id, userId, version: session.version },
      data: {
        draft: draft as unknown as Prisma.InputJsonValue,
        state: nextState,
        version: session.version + 1,
        expiresAt: new Date(receivedAt.getTime() + ttlFor(nextState)),
      },
    });
    if (updated.count !== 1) {
      await this.recordEvent(input, session.intent, ConversationOutcome.ERROR);
      return this.reply('ERROR', this.stateView(session), REPLIES.collectingReminder);
    }

    await this.recordEvent(input, session.intent, ConversationOutcome.RECOGNIZED);
    const next: SessionRow = {
      ...session,
      draft: draft as unknown as Prisma.JsonValue,
      state: nextState,
      version: session.version + 1,
    };
    return this.draftReply(next, today);
  }

  /** Resposta ao campo pendente, por tipo de rascunho. Só muda `draft` no caminho UPDATED. */
  private async answerPending(userId: string, draft: SessionDraft, value: string, today: string): Promise<PendingAnswer> {
    if (isTransactionChangeDraft(draft)) {
      return this.answerTransactionChange(userId, draft, value, today);
    }
    if (isTargetChangeDraft(draft)) {
      return this.answerTargetChange(userId, draft, value, today);
    }
    if (draft.kind === 'GOAL') {
      return this.answerGoal(userId, draft, value);
    }
    if (draft.kind === 'CONTRIBUTION') {
      return this.answerContribution(userId, draft, value);
    }
    if (draft.kind === 'ENVELOPE') {
      return this.answerEnvelope(userId, draft, value);
    }
    if (draft.kind === 'CARD_CREATE') {
      return this.answerCardCreate(userId, draft, value);
    }
    if (draft.kind === 'CARD_PICK') {
      return this.answerCardPick(userId, draft, value);
    }
    if (draft.kind === 'CATEGORY_CREATE') {
      return this.answerCategoryCreate(userId, draft, value);
    }
    if (draft.kind === 'CATEGORY_CHANGE') {
      return this.answerCategoryChange(userId, draft, value);
    }
    if (draft.kind === 'CARD_RENAME') {
      return { status: 'ERROR', text: REPLIES.collectingReminder };
    }
    if (draft.kind === 'CREDIT_LIMIT') {
      return this.answerCreditLimit(draft, value);
    }
    if (draft.kind === 'RECURRING') {
      return this.answerRecurring(draft, value, today);
    }
    if (draft.kind === 'INSTALLMENT') {
      return this.answerInstallment(draft, value, today);
    }
    return this.answerTransaction(userId, draft, value);
  }

  private async answerTransaction(userId: string, draft: ExpenseOrIncomeDraft, value: string): Promise<PendingAnswer> {
    if (draft.pendingField === 'amount') {
      const amount = parseAmountPrefix(value);
      if (amount.ok === false) {
        return { status: 'ERROR', text: amountErrorText(amount.reason) };
      }
      draft.amountCents = amount.cents;
      draft.pendingField = null;
      const rest = stripConnectors(splitTokens(amount.rest)).join(' ');
      if (draft.description === null && rest.length >= DESCRIPTION_MIN) {
        draft.description = rest;
      }
      if (draft.description === null) {
        draft.pendingField = 'description';
      } else {
        await this.resolveCategory(userId, draft, draft.description);
      }
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'description') {
      if (value.length < DESCRIPTION_MIN) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: REPLIES.askDescription };
      }
      if (value.length > DESCRIPTION_MAX) {
        return { status: 'ERROR', text: REPLIES.descriptionTooLong };
      }
      draft.description = value;
      draft.pendingField = null;
      await this.resolveCategory(userId, draft, value);
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'card') {
      const options = await this.cardChoiceOptions(userId, draft);
      if (options.length !== (draft.cardOptions ?? []).length) {
        // Algum cartao oferecido foi arquivado depois da lista: o numero que o usuario viu nao vale mais.
        // A resposta nao e usada; a lista nova e mostrada (e passa a ser a que vale).
        draft.cardOptions = options.map((card) => card.id);
        if (options.length === 0) draft.pendingField = null;
        return { status: 'UPDATED' };
      }
      const picked = pickCardAnswer(options, value);
      if (picked === null) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: CARD_EXPENSE_REPLIES.choose(options.map((card) => card.name)) };
      }
      pickCard(draft, picked);
      draft.cardOptions = [];
      draft.pendingField = null;
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'category') {
      draft.categoryId = await this.pickCategoryAnswer(userId, draft, value);
      draft.categoryOptions = [];
      draft.pendingField = null;
      return { status: 'UPDATED' };
    }
    return { status: 'ERROR', text: REPLIES.collectingReminder };
  }

  /** Nome (2 a 60, sem repetir meta ativa) e depois alvo ("sem alvo" = cofrinho). */
  private async answerGoal(userId: string, draft: GoalDraft, value: string): Promise<PendingAnswer> {
    if (draft.pendingField === 'title') {
      const length = codePointLength(value);
      if (length < GOAL_TITLE_MIN) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: REPLIES.askGoalTitle };
      }
      if (length > GOAL_TITLE_MAX) {
        return { status: 'ERROR', text: REPLIES.goalTitleTooLong };
      }
      if (await this.isGoalNameTaken(userId, value)) {
        return {
          status: 'ASK',
          outcome: ConversationOutcome.ERROR,
          question: REPLIES.askGoalTitle,
          prefix: REPLIES.goalNameTaken,
        };
      }
      draft.title = value;
      draft.pendingField = nextGoalPending(draft);
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'target') {
      if (isNoTargetAnswer(value)) {
        draft.noTarget = true;
        draft.targetCents = null;
        draft.pendingField = null;
        return { status: 'UPDATED' };
      }
      const amount = parseAmountPrefix(value);
      if (amount.ok === false) {
        return { status: 'ERROR', text: amountErrorText(amount.reason) };
      }
      if (amount.rest !== '') {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: REPLIES.askGoalTarget };
      }
      draft.targetCents = amount.cents;
      draft.pendingField = null;
      return { status: 'UPDATED' };
    }
    return { status: 'ERROR', text: REPLIES.collectingReminder };
  }

  /** Valor (centavos) e meta (opção numerada ou nome entre as opções oferecidas). */
  private async answerContribution(userId: string, draft: ContributionDraft, value: string): Promise<PendingAnswer> {
    if (draft.pendingField === 'amount') {
      const amount = parseAmountPrefix(value);
      if (amount.ok === false) {
        return { status: 'ERROR', text: amountErrorText(amount.reason) };
      }
      draft.amountCents = amount.cents;
      draft.pendingField = nextContributionPending(draft.goalId, draft.amountCents);
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'goal') {
      const pool = await this.optionGoals(userId, draft.goalOptions);
      const normalized = normalize(value);
      const isNumber = /^[1-5]$/.test(normalized);
      const numberedId = isNumber ? draft.goalOptions[Number(normalized) - 1] : undefined;
      const numbered = pool.find((goal) => goal.id === numberedId);
      const chosen = isNumber ? (numbered ? [numbered] : []) : matchGoalByTitle(value, pool);
      if (chosen.length !== 1) {
        return {
          status: 'ASK',
          outcome: ConversationOutcome.UNRECOGNIZED,
          question: goalOptionsText(draft.goalOptions.map((id) => {
            const goal = pool.find((candidate) => candidate.id === id);
            return goal ? truncate(goal.title) : 'indisponível';
          })),
        };
      }
      draft.goalId = chosen[0].id;
      draft.goalTitle = chosen[0].title;
      draft.goalOptions = [];
      draft.pendingField = nextContributionPending(draft.goalId, draft.amountCents);
      return { status: 'UPDATED' };
    }
    return { status: 'ERROR', text: REPLIES.collectingReminder };
  }

  /** Nome (2 a 60, sem repetir reserva do usuário) e depois valor mensal. */
  private async answerEnvelope(userId: string, draft: EnvelopeDraft, value: string): Promise<PendingAnswer> {
    if (draft.pendingField === 'name') {
      const length = codePointLength(value);
      if (length < ENVELOPE_NAME_MIN) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: REPLIES.askEnvelopeName };
      }
      if (length > ENVELOPE_NAME_MAX) {
        return { status: 'ERROR', text: REPLIES.envelopeNameTooLong };
      }
      if (await this.isEnvelopeNameTaken(userId, value)) {
        return { status: 'ASK', outcome: ConversationOutcome.ERROR, question: REPLIES.askEnvelopeName, prefix: REPLIES.envelopeNameTaken };
      }
      draft.name = value;
      draft.pendingField = draft.monthlyCents === null ? 'amount' : null;
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'amount') {
      const amount = parseAmountPrefix(value);
      if (amount.ok === false) {
        if (amount.reason === 'NOT_AMOUNT') {
          return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: REPLIES.askEnvelopeAmount, prefix: REPLIES.amountOnly };
        }
        return { status: 'ERROR', text: amountErrorText(amount.reason) };
      }
      if (amount.rest !== '') {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: REPLIES.askEnvelopeAmount, prefix: REPLIES.amountOnly };
      }
      draft.monthlyCents = amount.cents;
      draft.pendingField = draft.name === null ? 'name' : null;
      return { status: 'UPDATED' };
    }
    return { status: 'ERROR', text: REPLIES.collectingReminder };
  }

  /** Valor do limite: somente um valor completo, sem texto extra (o banco não é ignorado). */
  private async answerCreditLimit(draft: CreditLimitDraft, value: string): Promise<PendingAnswer> {
    if (draft.pendingField === 'amount') {
      const amount = parseAmountPrefix(value);
      if (amount.ok === false) {
        if (amount.reason === 'NOT_AMOUNT') {
          return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: creditLimitQuestion(draft), prefix: REPLIES.amountOnly };
        }
        return { status: 'ERROR', text: amountErrorText(amount.reason) };
      }
      if (amount.rest !== '') {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: creditLimitQuestion(draft), prefix: REPLIES.amountOnly };
      }
      draft.ceilingCents = amount.cents;
      draft.pendingField = null;
      return { status: 'UPDATED' };
    }
    return { status: 'ERROR', text: REPLIES.collectingReminder };
  }

  /** Conta fixa: descrição, valor por vencimento e primeiro vencimento, nessa ordem (contrato 4). */
  private answerRecurring(draft: RecurringDraft, value: string, today: string): PendingAnswer {
    if (draft.pendingField === 'description') {
      const refusal = descriptionRefusal(value, REPLIES.askDraftDescription);
      if (refusal) return refusal;
      draft.description = value;
      draft.pendingField = nextRecurringPending(draft);
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'amount') {
      const amount = amountAnswer(value, REPLIES.askRecurringAmount);
      if (amount.ok === false) return amount.answer;
      draft.amountCents = amount.cents;
      draft.pendingField = nextRecurringPending(draft);
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'firstDueDate') {
      const due = resolveFirstDue(value, today);
      if (due.kind !== 'DATE') return dueRefusal(due);
      draft.firstDueDate = due.ymd;
      draft.pendingField = nextRecurringPending(draft);
      return { status: 'UPDATED' };
    }
    return { status: 'ERROR', text: REPLIES.collectingReminder };
  }

  /**
   * Compra parcelada: descrição, total, quantidade e primeiro vencimento. Quantidade e total são
   * conferidos juntos antes de guardar: nenhuma parcela pode ficar abaixo de R$ 0,01.
   */
  private answerInstallment(draft: InstallmentDraft, value: string, today: string): PendingAnswer {
    if (draft.pendingField === 'description') {
      const refusal = descriptionRefusal(value, REPLIES.askDraftDescription);
      if (refusal) return refusal;
      draft.description = value;
      draft.pendingField = nextInstallmentPending(draft);
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'amount') {
      const amount = amountAnswer(value, REPLIES.askInstallmentTotal);
      if (amount.ok === false) return amount.answer;
      if (draft.installmentsTotal !== null && splitInstallments(amount.cents, draft.installmentsTotal) === null) {
        return { status: 'ASK', outcome: ConversationOutcome.ERROR, question: REPLIES.askInstallmentTotal, prefix: REPLIES.installmentTooSmall };
      }
      draft.totalCents = amount.cents;
      draft.pendingField = nextInstallmentPending(draft);
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'installmentsTotal') {
      const match = /^(\d+)x?$/.exec(normalize(value));
      if (match === null) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: REPLIES.askInstallmentsTotal };
      }
      const installmentsTotal = Number(match[1]);
      if (installmentsTotal < INSTALLMENTS_MIN || installmentsTotal > INSTALLMENTS_MAX) {
        return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question: REPLIES.askInstallmentsTotal, prefix: REPLIES.installmentsRange };
      }
      if (draft.totalCents !== null && splitInstallments(draft.totalCents, installmentsTotal) === null) {
        return { status: 'ASK', outcome: ConversationOutcome.ERROR, question: REPLIES.askInstallmentsTotal, prefix: REPLIES.installmentTooSmall };
      }
      draft.installmentsTotal = installmentsTotal;
      draft.pendingField = nextInstallmentPending(draft);
      return { status: 'UPDATED' };
    }
    if (draft.pendingField === 'firstDueDate') {
      const due = resolveFirstDue(value, today);
      if (due.kind !== 'DATE') return dueRefusal(due);
      draft.firstDueDate = due.ymd;
      draft.pendingField = nextInstallmentPending(draft);
      return { status: 'UPDATED' };
    }
    return { status: 'ERROR', text: REPLIES.collectingReminder };
  }

  /** Aplica o rascunho com a regra da secao 7: reivindicar, registrar chave, aplicar. */
  private async applyDraft(args: {
    userId: string;
    session: SessionRow;
    messageId: string | null;
    now: Date;
    channel?: ConversationChannel;
  }): Promise<ConversationReply> {
    const { userId, session, messageId, now } = args;
    const channel = args.channel ?? session.channel;
    const draft = session.draft as unknown as SessionDraft;

    const claim = await this.prisma.conversationSession.deleteMany({
      where: { id: session.id, userId, version: session.version },
    });
    if (claim.count !== 1) {
      await this.recordEventRaw({ userId, channel, messageId, intent: session.intent, outcome: ConversationOutcome.DUPLICATE });
      return this.reply('DUPLICATE', 'IDLE', REPLIES.duplicate);
    }

    const appliedKey = `${session.id}:${session.version}`;
    const event = await this.createAppliedEvent({
      userId,
      channel,
      messageId,
      intent: session.intent,
      appliedKey,
    });
    if (event === null) {
      return this.reply('DUPLICATE', 'IDLE', REPLIES.duplicate);
    }

    const categoryName = (await this.toDraftView(session)).category;
    let applied: AppliedAction;
    try {
      applied = await this.applyByKind(userId, draft, categoryName);
    } catch (error) {
      if (isWriteUncertain(error)) {
        // Commit sem confirmação: não restaura, não libera a chave e não oferece nova gravação (contrato 3).
        await this.prisma.conversationEvent
          .updateMany({ where: { id: event.id, userId }, data: { outcome: ConversationOutcome.ERROR } })
          .catch(() => undefined);
        return this.reply('ERROR', 'IDLE', REPLIES.writeUncertain);
      }
      const revision = revisedDraft(draft, error);
      if (revision) {
        // Nada gravado: o mês ou o ciclo mudou. Libera a chave e pede nova confirmação com os dados atuais.
        await this.prisma.conversationEvent.updateMany({
          where: { id: event.id, userId },
          data: { outcome: ConversationOutcome.ERROR, appliedKey: null },
        });
        return this.reviseDraft({ userId, session, draft: revision.draft, reason: revision.reason, channel, now });
      }
      // Falha ao gravar: nada foi gravado e a chave aplicada sai do evento.
      await this.prisma.conversationEvent.updateMany({
        where: { id: event.id, userId },
        data: { outcome: ConversationOutcome.ERROR, appliedKey: null },
      });
      const kind = draftKind(draft);
      // Erro 4xx (limite do plano, meta apagada, dado recusado) não melhora com nova tentativa: descarta (D5).
      if (isDiscardError(error)) {
        return this.reply('ERROR', 'IDLE', discardText(kind, error));
      }
      const restored = await this.restoreSession({ userId, session, channel, now });
      return this.reply(
        'ERROR',
        restored ? ConversationState.AWAITING_CONFIRMATION : 'IDLE',
        saveFailedText(kind, restored),
      );
    }

    // A ação já existe: falha só da métrica não pode virar erro 500 (o usuário refaria e duplicaria).
    await this.prisma.conversationEvent
      .updateMany({
        where: { id: event.id, userId },
        data: { outcome: ConversationOutcome.COMPLETED, resultRef: applied.resultRef },
      })
      .catch(() => undefined);
    const pendingText = applied.materializationPending
      ? REPLIES.materializationPending
      : applied.refreshPending
        ? REPLIES.refreshPending
        : null;
    const text = pendingText ? `${applied.text}\n${pendingText}` : applied.text;
    return { kind: 'DONE', state: 'IDLE', text, data: applied.data };
  }

  /**
   * Condição revisável (contrato 3): o rascunho volta com os dados atuais, versão + 1 e prazo novo de
   * confirmação. Nenhuma escrita aconteceu. Se outro rascunho já ocupou o lugar, não sobrescreve.
   */
  private async reviseDraft(args: {
    userId: string;
    session: SessionRow;
    draft: SessionDraft;
    reason: string;
    channel: ConversationChannel;
    now: Date;
  }): Promise<ConversationReply> {
    const { userId, session, reason, channel, now } = args;
    const revised = { ...args.draft, reviewReason: reason } as SessionDraft;
    // Campo que voltou a faltar (vencimento no passado) pede a coleta de novo; o resto volta à confirmação.
    const next: SessionRow = {
      ...session,
      draft: revised as unknown as Prisma.JsonValue,
      state: revised.pendingField ? ConversationState.COLLECTING_FIELDS : ConversationState.AWAITING_CONFIRMATION,
      version: session.version + 1,
    };
    const restored = await this.restoreSession({ userId, session: next, channel, now });
    if (!restored) {
      return this.reply('ERROR', 'IDLE', REPLIES.revisionRestoreLost);
    }
    return this.draftReply(next, await this.todayYmd(userId, now), { prefix: reason });
  }

  /** Um caso por tipo de rascunho. Só este método chama o serviço financeiro ou de metas. */
  private async applyByKind(userId: string, draft: SessionDraft, categoryName: string | null): Promise<AppliedAction> {
    if (isTransactionChangeDraft(draft)) {
      return this.applyTransactionChange(userId, draft);
    }
    if (isTargetChangeDraft(draft)) {
      return this.applyTargetChange(userId, draft);
    }
    if (draft.kind === 'GOAL') {
      return this.applyGoal(userId, draft);
    }
    if (draft.kind === 'CONTRIBUTION') {
      return this.applyContribution(userId, draft);
    }
    if (draft.kind === 'ENVELOPE') {
      return this.applyEnvelope(userId, draft);
    }
    if (draft.kind === 'CARD_RENAME') {
      return this.applyCardRename(userId, draft);
    }
    if (draft.kind === 'CARD_CREATE') {
      return this.applyCardCreate(userId, draft);
    }
    if (draft.kind === 'CARD_PICK') {
      throw new Error('rascunho de escolha de cartao nao se confirma');
    }
    if (draft.kind === 'CATEGORY_CREATE') {
      return this.applyCategoryCreate(userId, draft);
    }
    if (draft.kind === 'CATEGORY_CHANGE') {
      return this.applyCategoryChange(userId, draft);
    }
    if (draft.kind === 'CREDIT_LIMIT') {
      return this.applyCreditLimit(userId, draft);
    }
    if (draft.kind === 'RECURRING') {
      return this.applyRecurring(userId, draft);
    }
    if (draft.kind === 'INSTALLMENT') {
      return this.applyInstallment(userId, draft);
    }
    return this.applyTransaction(userId, draft, categoryName);
  }

  /** Reserva: envelope e provisão inicial na mesma transação, no serviço (EnvelopesService.createForConversation). */
  private async applyEnvelope(userId: string, draft: EnvelopeDraft): Promise<AppliedAction> {
    if (draft.name === null || draft.monthlyCents === null) {
      throw new Error('rascunho de reserva incompleto');
    }
    const receipt = await this.envelopes.createForConversation(
      userId,
      { name: draft.name, color: draft.color, monthlyAmount: draft.monthlyCents / 100 },
      draft.provisionMonth,
    );
    return {
      text: envelopeCreatedText({ name: receipt.name, monthlyCents: receipt.monthlyCents }),
      data: { envelopeId: receipt.id },
      resultRef: receipt.id,
      refreshPending: receipt.refreshPending,
    };
  }

  /** Teto do ciclo: o serviço confere ciclo, teto vigente e opção sob bloqueio antes de gravar (8d: por cartao). */
  private async applyCreditLimit(userId: string, draft: CreditLimitDraft): Promise<AppliedAction> {
    if (draft.action === 'clear') {
      if (draft.cardId === null || draft.previousCeilingCents === null) {
        throw new Error('rascunho de limpeza de limite incompleto');
      }
      const removed = await this.creditCycle.removeCeilingForConversation(
        userId,
        {
          cycleStart: draft.cycleStart,
          cycleEnd: draft.cycleEnd,
          previousCeilingCents: draft.previousCeilingCents,
          countAllPayments: draft.countAllPayments,
        },
        draft.cardId,
      );
      return {
        text: creditLimitClearText({ previousCents: removed.removedCents, cycleEnd: removed.cycleEnd, cardName: draft.cardName }),
        data: {},
        resultRef: removed.id,
        refreshPending: removed.refreshPending,
      };
    }
    if (draft.ceilingCents === null) {
      throw new Error('rascunho de limite incompleto');
    }
    const receipt = await this.creditCycle.setCeilingForConversation(
      userId,
      { ceiling: draft.ceilingCents / 100 },
      {
        cycleStart: draft.cycleStart,
        cycleEnd: draft.cycleEnd,
        previousCeilingCents: draft.previousCeilingCents,
        countAllPayments: draft.countAllPayments,
      },
      draft.cardId ?? undefined,
    );
    return {
      text: creditLimitSetText({ ceilingCents: receipt.ceilingCents, cycleEnd: receipt.cycleEnd, cardName: draft.cardName }),
      data: {},
      resultRef: receipt.id,
      refreshPending: receipt.refreshPending,
    };
  }

  /** Conta fixa: a gravação e a materialização vêm do núcleo do serviço; o texto sai do recibo. */
  private async applyRecurring(userId: string, draft: RecurringDraft): Promise<AppliedAction> {
    if (draft.description === null || draft.amountCents === null || draft.firstDueDate === null) {
      throw new Error('rascunho de conta fixa incompleto');
    }
    const receipt = await this.recurring.createForConversation(
      userId,
      {
        type: TransactionType.EXPENSE,
        description: draft.description,
        amount: draft.amountCents / 100,
        frequency: draft.frequency,
        firstDueDate: draft.firstDueDate,
      },
      RECURRING_WRITE_RULES,
    );
    return {
      text: recurringCreatedText({
        description: receipt.description,
        amountCents: receipt.amountCents,
        frequency: receipt.frequency,
        firstDueDate: receipt.firstDueDate,
      }),
      data: { recurringTransactionId: receipt.id },
      resultRef: receipt.id,
      materializationPending: receipt.materializationPending,
      refreshPending: receipt.refreshPending,
    };
  }

  /** Compra parcelada: o serviço divide o total e confere a parcela mínima; o motor não divide. */
  private async applyInstallment(userId: string, draft: InstallmentDraft): Promise<AppliedAction> {
    if (draft.description === null || draft.totalCents === null || draft.installmentsTotal === null || draft.firstDueDate === null) {
      throw new Error('rascunho de compra parcelada incompleto');
    }
    const receipt = await this.installments.createForConversation(
      userId,
      {
        description: draft.description,
        totalAmount: draft.totalCents / 100,
        installmentsTotal: draft.installmentsTotal,
        firstDueDate: draft.firstDueDate,
      },
      RECURRING_WRITE_RULES,
    );
    return {
      text: installmentCreatedText({
        description: receipt.description,
        totalCents: receipt.totalCents,
        installmentsTotal: receipt.installmentsTotal,
        firstDueDate: receipt.firstDueDate,
        toneSeed: draft.toneSeed,
      }),
      data: { installmentPurchaseId: receipt.id },
      resultRef: receipt.id,
      materializationPending: receipt.materializationPending,
      refreshPending: receipt.refreshPending,
    };
  }

  /**
   * Apaga ou edita o lançamento escolhido. Relê com id + userId; se sumiu, nada é gravado (contrato 8a, secao 4).
   * Apagar usa o mesmo TransactionsService.remove da tela (apagamento definitivo).
   */
  private async applyTransactionChange(userId: string, draft: TransactionChangeDraft): Promise<AppliedAction> {
    const target = draft.targetId === null ? null : await this.loadTxCandidate(userId, draft.targetId);
    if (target === null) {
      throw new NotFoundException(TX_REPLIES.gone);
    }
    if (!target.eligible) {
      // Rascunho antigo ou ids trocados: a regra de elegibilidade vale também na aplicação.
      throw new BadRequestException(TX_REPLIES.onlyNonEditable);
    }
    // Conflito: o item mudou desde a escolha (ex.: editado pela tela). Vale tambem para apagar
    // (decisao do dono em 2026-11-23: apagar confere updatedAt como editar). Nada é gravado (contrato 8a, secao 5).
    if (target.updatedAt.toISOString() !== draft.targetUpdatedAt) {
      throw new ConflictException(TX_REPLIES.changed);
    }
    if (draft.action === 'DELETE') {
      await this.transactions.remove(userId, target.id);
      return {
        text: `Apaguei: ${describeCandidate(target)}.`,
        data: { transactionId: target.id },
        resultRef: target.id,
      };
    }
    const dto: UpdateTransactionDto = {};
    if (draft.changes.amountCents !== undefined) dto.amount = draft.changes.amountCents / 100;
    if (draft.changes.description !== undefined) dto.description = draft.changes.description;
    if (draft.changes.categoryId !== undefined) {
      dto.categoryId = draft.changes.categoryId;
      // Com o tipo informado o serviço recusa categoria do outro tipo.
      dto.type = target.type;
    }
    if (draft.changes.date !== undefined) dto.date = `${draft.changes.date}T00:00:00.000Z`;
    try {
      // updatedAt vai ao serviço: ele bloqueia a linha (FOR NO KEY UPDATE) e compara dentro da transação.
      await this.transactions.update(userId, target.id, dto, new Date(draft.targetUpdatedAt));
    } catch (error) {
      if (error instanceof ConflictException) throw new ConflictException(TX_REPLIES.changed);
      throw error;
    }
    const amountCents = draft.changes.amountCents ?? target.amountCents;
    const description = draft.changes.description ?? target.description;
    return {
      text: `Alterei: ${formatCents(amountCents)} · ${description}.`,
      data: { transactionId: target.id },
      resultRef: target.id,
    };
  }

  // ---------- editar/apagar meta e reserva (contrato 8b) ----------

  /** Editar/apagar meta ou reserva: busca e lista numerada, ou pergunta qual (contrato 8b, secao 3). */
  private async startTargetChange(args: {
    input: ConversationInput;
    kind: TargetChangeDraft['kind'];
    action: 'EDIT' | 'DELETE';
    body: string;
  }): Promise<ConversationReply> {
    const { input, kind, action, body } = args;
    const noun =
      kind === 'GOAL_CHANGE' ? 'goal' : kind === 'ENVELOPE_CHANGE' ? 'envelope' : kind === 'RECURRING_CHANGE' ? 'recurring' : 'installment';
    const intent = `${action === 'DELETE' ? 'delete' : 'edit'}_${noun}`;
    const draft: TargetChangeDraft = {
      kind,
      action,
      candidateIds: [],
      targetId: null,
      targetUpdatedAt: null,
      changes: {},
      pendingField: 'targetChoice',
    };
    if (body.length > 0) {
      const found = await this.searchTargets(input.userId, kind, body);
      if (found.length === 0) {
        await this.recordEvent(input, intent, ConversationOutcome.RECOGNIZED);
        return this.reply('INFO', 'IDLE', this.targetNotFoundText(kind));
      }
      draft.candidateIds = found.map((candidate) => candidate.id);
    } else if (kind === 'GOAL_CHANGE') {
      const goals = await this.prisma.goal.findMany({
        where: { userId: input.userId },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
        take: TARGET_LIST_MAX,
      });
      if (goals.length === 0) {
        await this.recordEvent(input, intent, ConversationOutcome.RECOGNIZED);
        return this.reply('INFO', 'IDLE', TG_REPLIES.goalListEmpty);
      }
      draft.candidateIds = goals.map((goal) => goal.id);
    }
    const today = await this.todayYmd(input.userId, input.receivedAt);
    return this.saveNewDraft({ input, intent, draft, today });
  }

  /**
   * Busca do alvo (contratos 8b e 8c, secoes 3): metas de qualquer status, reservas, contas fixas
   * (todos os status) e parcelados que ainda tem o que gerar; nome sem acento e caixa filtrado em
   * memoria (como no 8a), ate 5, mais recentes primeiro.
   */
  private async searchTargets(
    userId: string,
    kind: TargetChangeDraft['kind'],
    body: string,
  ): Promise<Array<GoalCandidate | EnvelopeCandidate | RecurringCandidate | InstallmentCandidate>> {
    const term = normalize(body.trim());
    if (term.length === 0) {
      return [];
    }
    if (kind === 'GOAL_CHANGE') {
      const rows = await this.prisma.goal.findMany({ where: { userId }, select: GOAL_CHANGE_SELECT, orderBy: { updatedAt: 'desc' } });
      return rows
        .filter((row) => matchesName(row.title, term))
        .slice(0, TARGET_CHANGE_MAX_CANDIDATES)
        .map(toGoalCandidateRow);
    }
    if (kind === 'RECURRING_CHANGE') {
      const rows = await this.prisma.recurringTransaction.findMany({
        where: { userId },
        select: RECURRING_CHANGE_SELECT,
        orderBy: { updatedAt: 'desc' },
      });
      return rows
        .filter((row) => matchesName(row.description, term))
        .slice(0, TARGET_CHANGE_MAX_CANDIDATES)
        .map(toRecurringCandidateRow);
    }
    if (kind === 'INSTALLMENT_CHANGE') {
      // Lista so o que ainda tem parcela a gerar (contrato 8c, secao 3): apagar o resto nao tem efeito na conversa.
      const rows = await this.prisma.installmentPurchase.findMany({
        where: { userId, isActive: true, nextDueDate: { not: null } },
        select: INSTALLMENT_CHANGE_SELECT,
        orderBy: { updatedAt: 'desc' },
      });
      return rows
        .filter((row) => matchesName(row.description, term))
        .slice(0, TARGET_CHANGE_MAX_CANDIDATES)
        .map(toInstallmentCandidateRow);
    }
    const rows = await this.prisma.envelope.findMany({
      where: { userId },
      select: ENVELOPE_CHANGE_SELECT,
      orderBy: { updatedAt: 'desc' },
    });
    return rows
      .filter((row) => matchesName(row.name, term))
      .slice(0, TARGET_CHANGE_MAX_CANDIDATES)
      .map(toEnvelopeCandidateRow);
  }

  /** Alvo do usuario pelo id (id + userId, nunca so o id). */
  private async loadTargetCandidate(
    userId: string,
    kind: TargetChangeDraft['kind'],
    id: string,
  ): Promise<GoalCandidate | EnvelopeCandidate | RecurringCandidate | InstallmentCandidate | null> {
    if (kind === 'GOAL_CHANGE') {
      const row = await this.prisma.goal.findFirst({ where: { id, userId }, select: GOAL_CHANGE_SELECT });
      return row === null ? null : toGoalCandidateRow(row);
    }
    if (kind === 'RECURRING_CHANGE') {
      const row = await this.prisma.recurringTransaction.findFirst({ where: { id, userId }, select: RECURRING_CHANGE_SELECT });
      return row === null ? null : toRecurringCandidateRow(row);
    }
    if (kind === 'INSTALLMENT_CHANGE') {
      // Sem filtro de status aqui: se a ultima parcela saiu do meio do fluxo, o conflito de updatedAt cuida.
      const row = await this.prisma.installmentPurchase.findFirst({ where: { id, userId }, select: INSTALLMENT_CHANGE_SELECT });
      return row === null ? null : toInstallmentCandidateRow(row);
    }
    const row = await this.prisma.envelope.findFirst({ where: { id, userId }, select: ENVELOPE_CHANGE_SELECT });
    return row === null ? null : toEnvelopeCandidateRow(row);
  }

  /** Lista numerada dos candidatos que ainda existem (sumido sai da lista, numeracao preserva a ordem). */
  private async targetListText(userId: string, kind: TargetChangeDraft['kind'], ids: string[]): Promise<string> {
    const header =
      kind === 'GOAL_CHANGE'
        ? TG_REPLIES.pickHeaderGoal
        : kind === 'ENVELOPE_CHANGE'
          ? TG_REPLIES.pickHeaderEnvelope
          : kind === 'RECURRING_CHANGE'
            ? RC_REPLIES.pickHeaderRecurring
            : RC_REPLIES.pickHeaderInstallment;
    if (kind === 'RECURRING_CHANGE') {
      const rows = await this.prisma.recurringTransaction.findMany({ where: { userId, id: { in: ids } }, select: RECURRING_CHANGE_SELECT });
      const byId = new Map(rows.map((row) => [row.id, toRecurringCandidateRow(row)]));
      const lines = ids
        .map((id, index) => {
          const candidate = byId.get(id);
          return candidate ? formatRecurringLine(index, candidate) : null;
        })
        .filter((line): line is string => line !== null);
      return [header, ...lines].join('\n');
    }
    if (kind === 'INSTALLMENT_CHANGE') {
      const rows = await this.prisma.installmentPurchase.findMany({ where: { userId, id: { in: ids } }, select: INSTALLMENT_CHANGE_SELECT });
      const byId = new Map(rows.map((row) => [row.id, toInstallmentCandidateRow(row)]));
      const lines = ids
        .map((id, index) => {
          const candidate = byId.get(id);
          return candidate ? formatInstallmentLine(index, candidate) : null;
        })
        .filter((line): line is string => line !== null);
      return [header, ...lines].join('\n');
    }
    if (kind === 'GOAL_CHANGE') {
      const rows = await this.prisma.goal.findMany({ where: { userId, id: { in: ids } }, select: GOAL_CHANGE_SELECT });
      const byId = new Map(rows.map((row) => [row.id, toGoalCandidateRow(row)]));
      const lines = ids
        .map((id, index) => {
          const candidate = byId.get(id);
          return candidate ? formatGoalLine(index, candidate) : null;
        })
        .filter((line): line is string => line !== null);
      return [header, ...lines].join('\n');
    }
    const rows = await this.prisma.envelope.findMany({ where: { userId, id: { in: ids } }, select: ENVELOPE_CHANGE_SELECT });
    const byId = new Map(rows.map((row) => [row.id, toEnvelopeCandidateRow(row)]));
    const lines = ids
      .map((id, index) => {
        const candidate = byId.get(id);
        return candidate ? formatEnvelopeLine(index, candidate) : null;
      })
      .filter((line): line is string => line !== null);
    return [header, ...lines].join('\n');
  }

  /** Resposta a lista: numero escolhe; sem candidatos, o texto e a busca. Mudanca de campo: etapa de editar. */
  private async answerTargetChange(
    userId: string,
    draft: TargetChangeDraft,
    value: string,
    today: string,
  ): Promise<PendingAnswer> {
    const gone = this.targetGoneText(draft.kind);
    if (draft.pendingField === 'targetChoice') {
      if (draft.candidateIds.length === 0) {
        // Comando sem termo ("apagar meta"): o texto seguinte e a busca.
        const found = await this.searchTargets(userId, draft.kind, value);
        if (found.length === 0) {
          return { status: 'ERROR', text: this.targetNotFoundText(draft.kind) };
        }
        draft.candidateIds = found.map((candidate) => candidate.id);
        return { status: 'UPDATED' };
      }
      const chosen = /^\d{1,2}$/.test(value) ? draft.candidateIds[Number(value) - 1] : undefined;
      if (chosen === undefined) {
        return {
          status: 'ASK',
          outcome: ConversationOutcome.UNRECOGNIZED,
          question: await this.targetListText(userId, draft.kind, draft.candidateIds),
        };
      }
      const row = await this.loadTargetCandidate(userId, draft.kind, chosen);
      if (row === null) {
        return { status: 'ERROR', text: gone };
      }
      draft.targetId = row.id;
      draft.targetUpdatedAt = row.updatedAt.toISOString();
      draft.candidateIds = [];
      draft.pendingField = draft.action === 'EDIT' ? 'change' : null;
      return { status: 'UPDATED' };
    }
    // Editar: uma mudanca por mensagem; previa mostra antes -> depois (contrato 8b, secao 5).
    if (draft.targetId === null) {
      return { status: 'ERROR', text: gone };
    }
    const parsed =
      draft.kind === 'RECURRING_CHANGE'
        ? parseRecurringChange(value, today, amountErrorText)
        : draft.kind === 'INSTALLMENT_CHANGE'
          ? ({ ok: false, text: RC_REPLIES.installmentNoEdit } as const)
          : parseTargetChange(draft.kind, value, today, amountErrorText);
    if (parsed.ok === false) {
      return { status: 'ERROR', text: parsed.text };
    }
    if (parsed.field === 'title') {
      draft.changes.title = parsed.text;
    } else if (parsed.field === 'name') {
      draft.changes.name = parsed.text;
    } else if (parsed.field === 'targetCents') {
      draft.changes.targetCents = parsed.cents;
    } else if (parsed.field === 'targetDate') {
      draft.changes.targetDate = parsed.ymd;
    } else if (parsed.field === 'monthlyCents') {
      draft.changes.monthlyCents = parsed.cents;
    } else if (parsed.field === 'description') {
      draft.changes.description = parsed.text;
    } else if (parsed.field === 'amountCents') {
      draft.changes.amountCents = parsed.cents;
    } else if (parsed.field === 'endDate') {
      draft.changes.endDate = parsed.ymd;
    }
    draft.pendingField = null;
    return { status: 'UPDATED' };
  }

  /** Previa do rascunho de editar/apagar meta ou reserva. Apagar so confirma com a palavra "apagar" (contrato 8b, secao 4). */
  private async targetChangeText(userId: string, draft: TargetChangeDraft): Promise<string> {
    const target = draft.targetId === null ? null : await this.loadTargetCandidate(userId, draft.kind, draft.targetId);
    if (target === null) {
      return this.targetGoneText(draft.kind);
    }
    const noun =
      draft.kind === 'GOAL_CHANGE'
        ? 'meta'
        : draft.kind === 'ENVELOPE_CHANGE'
          ? 'reserva'
          : draft.kind === 'RECURRING_CHANGE'
            ? 'conta fixa'
            : 'compra parcelada';
    const described =
      'title' in target
        ? describeGoal(target)
        : 'name' in target
          ? describeEnvelope(target)
          : 'frequency' in target
            ? describeRecurring(target)
            : describeInstallment(target);
    if (draft.action === 'DELETE') {
      const note =
        'title' in target
          ? TG_REPLIES.goalDeleteNote
          : 'name' in target
            ? TG_REPLIES.envelopeDeleteNote
            : 'frequency' in target
              ? RC_REPLIES.recurringDeleteNote
              : RC_REPLIES.installmentDeleteNote;
      return [`Apagar ${noun}: ${described}.`, note, TG_REPLIES.deleteWarning, TG_REPLIES.deleteNeedsWord].join('\n');
    }
    const rows = this.targetRows(draft.kind, 'EDIT', target, draft.changes);
    const changed = rows.filter((row) => row.label !== 'Aviso');
    if (changed.length === 0) {
      return TG_REPLIES.nothingToChange;
    }
    const lines = [`Editar ${noun}: ${described}.`, ...changed.map((row) => `${row.label}: ${row.value}`)];
    if (rows.some((row) => row.label === 'Aviso')) {
      lines.push(TG_REPLIES.envelopeAmountNote);
    }
    lines.push(TG_REPLIES.editConfirm);
    return lines.join('\n');
  }

  /** Linhas do cartao: apagar mostra o alvo inteiro; editar, "antes -> depois" so do que muda (contrato 8b, secoes 4 e 5). */
  private targetRows(
    kind: TargetChangeDraft['kind'],
    action: 'EDIT' | 'DELETE',
    target: GoalCandidate | EnvelopeCandidate | RecurringCandidate | InstallmentCandidate,
    changes: TargetChangeDraft['changes'],
  ): DraftView['rows'] {
    if (action === 'DELETE') {
      if ('title' in target) {
        const rows: DraftView['rows'] = [
          { label: 'Nome', value: target.title },
          { label: 'Situação', value: STATUS_PT[target.status] },
          { label: 'Guardado', value: formatBrl(target.currentCents) },
          { label: 'Alvo', value: target.targetCents === null ? 'sem alvo' : formatBrl(target.targetCents) },
        ];
        if (target.targetDate !== null) {
          rows.push({ label: 'Prazo', value: formatDateFull(target.targetDate) });
        }
        rows.push({ label: 'Aviso', value: TG_REPLIES.goalDeleteNote });
        return rows;
      }
      if ('frequency' in target) {
        const rows: DraftView['rows'] = [
          { label: 'Nome', value: target.description },
          { label: 'Valor', value: `${formatBrl(target.amountCents)}/${FREQ_PT[target.frequency]}` },
          { label: 'Situação', value: target.isActive ? 'ativa' : 'pausada' },
          { label: 'Vence', value: formatDateFull(target.nextDueDate) },
        ];
        if (target.endDate !== null) {
          rows.push({ label: 'Data final', value: formatDateFull(target.endDate) });
        }
        rows.push({ label: 'Aviso', value: RC_REPLIES.recurringDeleteNote });
        return rows;
      }
      if ('installmentsTotal' in target) {
        return [
          { label: 'Nome', value: target.description },
          { label: 'Valor total', value: formatBrl(target.totalCents) },
          { label: 'Parcela', value: `${formatBrl(target.installmentCents)} · ${target.installmentsGenerated} de ${target.installmentsTotal}` },
          { label: 'Aviso', value: RC_REPLIES.installmentDeleteNote },
        ];
      }
      return [
        { label: 'Nome', value: target.name },
        { label: 'Valor mensal', value: `${formatBrl(target.monthlyCents)}/mês` },
        { label: 'Situação', value: target.isActive ? 'ativa' : 'pausada' },
        { label: 'Aviso', value: TG_REPLIES.envelopeDeleteNote },
      ];
    }
    const rows: DraftView['rows'] = [];
    if ('frequency' in target) {
      // Editar conta fixa (D2 do dono): descricao, valor e data final.
      if (changes.description !== undefined && changes.description !== target.description) {
        rows.push({ label: 'Nome', value: `${target.description} → ${changes.description}` });
      }
      if (changes.amountCents !== undefined && changes.amountCents !== target.amountCents) {
        rows.push({ label: 'Valor', value: `${formatBrl(target.amountCents)} → ${formatBrl(changes.amountCents)}` });
      }
      if (changes.endDate !== undefined) {
        const before = target.endDate === null ? 'sem prazo' : formatDateFull(target.endDate);
        const after = changes.endDate === null ? 'sem prazo' : formatDateFull(changes.endDate);
        if (before !== after) {
          rows.push({ label: 'Data final', value: `${before} → ${after}` });
        }
      }
      return rows;
    }
    if ('title' in target) {
      if (changes.title !== undefined && changes.title !== target.title) {
        rows.push({ label: 'Título', value: `${target.title} → ${changes.title}` });
      }
      if (changes.targetCents !== undefined) {
        const before = target.targetCents === null ? 'sem alvo' : formatBrl(target.targetCents);
        const after = changes.targetCents === null ? 'sem alvo' : formatBrl(changes.targetCents);
        if (before !== after) {
          rows.push({ label: 'Valor alvo', value: `${before} → ${after}` });
        }
      }
      if (changes.targetDate !== undefined) {
        const before = target.targetDate === null ? 'sem prazo' : formatDateFull(target.targetDate);
        const after = changes.targetDate === null ? 'sem prazo' : formatDateFull(changes.targetDate);
        if (before !== after) {
          rows.push({ label: 'Prazo', value: `${before} → ${after}` });
        }
      }
      return rows;
    }
    if ('name' in target) {
      if (changes.name !== undefined && changes.name !== target.name) {
        rows.push({ label: 'Nome', value: `${target.name} → ${changes.name}` });
      }
      if (changes.monthlyCents !== undefined && changes.monthlyCents !== target.monthlyCents) {
        rows.push({ label: 'Valor mensal', value: `${formatBrl(target.monthlyCents)} → ${formatBrl(changes.monthlyCents)}` });
        // Decisao do dono (contrato 8b, secao 5): o valor novo so vale do proximo deposito em diante.
        rows.push({ label: 'Aviso', value: TG_REPLIES.envelopeAmountNote });
      }
    }
    // 'installmentsTotal' in target: parcelado nao edita (D3); as linhas ficam vazias e o confirmar-sem-mudanca barraria.
    return rows;
  }

  /**
   * Apaga ou edita a meta/reserva escolhida (contrato 8b, secoes 4 a 6). Reli com id + userId; conflito de
   * updatedAt recusa nos dois caminhos (decisao do 8a extendida); gravacao pelos mesmos servicos da tela.
   */
  private async applyTargetChange(userId: string, draft: TargetChangeDraft): Promise<AppliedAction> {
    const target = draft.targetId === null ? null : await this.loadTargetCandidate(userId, draft.kind, draft.targetId);
    if (target === null) {
      throw new NotFoundException(this.targetGoneText(draft.kind));
    }
    if (target.updatedAt.toISOString() !== draft.targetUpdatedAt) {
      throw new ConflictException(this.targetChangedText(draft.kind));
    }
    if (draft.kind === 'GOAL_CHANGE' && 'title' in target) {
      if (draft.action === 'DELETE') {
        await this.goals.remove(userId, target.id);
        return {
          text: `Apaguei a meta "${target.title}". ${TG_REPLIES.goalDeleteNote}`,
          data: { goalId: target.id },
          resultRef: target.id,
        };
      }
      const dto: UpdateGoalDto = {};
      if (draft.changes.title !== undefined) dto.title = draft.changes.title;
      if (draft.changes.targetCents !== undefined) {
        dto.targetAmount = draft.changes.targetCents === null ? null : draft.changes.targetCents / 100;
      }
      if (draft.changes.targetDate !== undefined) {
        dto.targetDate = draft.changes.targetDate === null ? null : `${draft.changes.targetDate}T00:00:00.000Z`;
      }
      await this.goals.update(userId, target.id, dto);
      return { text: `Alterei a meta "${target.title}".`, data: { goalId: target.id }, resultRef: target.id };
    }
    if (draft.kind === 'ENVELOPE_CHANGE' && 'name' in target) {
      if (draft.action === 'DELETE') {
        await this.envelopes.remove(userId, target.id);
        return {
          text: `Apaguei a reserva "${target.name}". ${TG_REPLIES.envelopeDeleteNote}`,
          data: { envelopeId: target.id },
          resultRef: target.id,
        };
      }
      const dto: UpdateEnvelopeDto = {};
      if (draft.changes.name !== undefined) dto.name = draft.changes.name;
      if (draft.changes.monthlyCents !== undefined) dto.monthlyAmount = draft.changes.monthlyCents / 100;
      // O servico da tela checa entitlement (reativacao) e duplicidade de nome; nos nao mexemos em isActive.
      await this.envelopes.update(userId, target.id, dto);
      return { text: `Alterei a reserva "${target.name}".`, data: { envelopeId: target.id }, resultRef: target.id };
    }
    if (draft.kind === 'RECURRING_CHANGE' && 'frequency' in target) {
      if (draft.action === 'DELETE') {
        // D4: o servico da tela solta os lancamentos ja gerados (SetNull) e mata as geracoes futuras.
        await this.recurring.remove(userId, target.id);
        return {
          text: `Apaguei a conta fixa "${target.description}". ${RC_REPLIES.recurringDeleteNote}`,
          data: { recurringTransactionId: target.id },
          resultRef: target.id,
        };
      }
      const dto: UpdateRecurringTransactionDto = {};
      if (draft.changes.description !== undefined) dto.description = draft.changes.description;
      if (draft.changes.amountCents !== undefined) dto.amount = draft.changes.amountCents / 100;
      if (draft.changes.endDate !== undefined) dto.endDate = draft.changes.endDate;
      // Sem isActive no DTO: nem pausamos nem retomamos (D5); sem checar entitlement (o servico so cobra na retomada).
      await this.recurring.update(userId, target.id, dto);
      return { text: `Alterei a conta fixa "${target.description}".`, data: { recurringTransactionId: target.id }, resultRef: target.id };
    }
    if (draft.kind === 'INSTALLMENT_CHANGE' && 'installmentsTotal' in target) {
      // D3: parcelado pelo chat so apaga (editar vem barrado antes de existir rascunho).
      if (draft.action === 'DELETE') {
        await this.installments.remove(userId, target.id);
        return {
          text: `Apaguei a compra parcelada "${target.description}". ${RC_REPLIES.installmentDeleteNote}`,
          data: { installmentPurchaseId: target.id },
          resultRef: target.id,
        };
      }
    }
    // kind e linha nao bateram (nao deve acontecer; leitura era do mesmo id): recusa como sumido.
    throw new NotFoundException(this.targetGoneText(draft.kind));
  }

  private targetNotFoundText(kind: TargetChangeDraft['kind']): string {
    return kind === 'GOAL_CHANGE'
      ? TG_REPLIES.goalNotFound
      : kind === 'ENVELOPE_CHANGE'
        ? TG_REPLIES.envelopeNotFound
        : kind === 'RECURRING_CHANGE'
          ? RC_REPLIES.recurringNotFound
          : RC_REPLIES.installmentNotFound;
  }

  private targetGoneText(kind: TargetChangeDraft['kind']): string {
    return kind === 'GOAL_CHANGE'
      ? TG_REPLIES.goalGone
      : kind === 'ENVELOPE_CHANGE'
        ? TG_REPLIES.envelopeGone
        : kind === 'RECURRING_CHANGE'
          ? RC_REPLIES.recurringGone
          : RC_REPLIES.installmentGone;
  }

  private targetChangedText(kind: TargetChangeDraft['kind']): string {
    return kind === 'GOAL_CHANGE'
      ? TG_REPLIES.goalChanged
      : kind === 'ENVELOPE_CHANGE'
        ? TG_REPLIES.envelopeChanged
        : kind === 'RECURRING_CHANGE'
          ? RC_REPLIES.recurringChanged
          : RC_REPLIES.installmentChanged;
  }

  private async applyTransaction(userId: string, draft: ExpenseOrIncomeDraft, categoryName: string | null): Promise<AppliedAction> {
    const created = await this.transactions.create(userId, {
      type: draft.type,
      description: draft.description,
      amount: draft.amountCents / 100,
      // Meia-noite UTC, igual à tela de Finanças (new Date('YYYY-MM-DD')). O ciclo do cartão
      // usa `lte` na meia-noite UTC do dia de fechamento: meio-dia deixaria a compra desse dia fora do ciclo.
      date: `${draft.date}T00:00:00.000Z`,
      categoryId: draft.categoryId ?? undefined,
      paymentMethod: draft.paymentMethod ?? undefined,
      cardId: draft.cardId ?? undefined,
    });
    return {
      text: doneText(draft.type, draft.amountCents, draft.description ?? '', draft.cardName ?? null, {
        seed: draft.toneSeed,
        category: categoryName,
      }),
      data: { transactionId: created.id },
      resultRef: created.id,
    };
  }

  /** Meta nova nasce ativa, sem data-alvo e sem aporte automático (contrato D6). */
  private async applyGoal(userId: string, draft: GoalDraft): Promise<AppliedAction> {
    if (draft.title === null) {
      throw new Error('rascunho de meta sem nome');
    }
    const goal = (await this.goals.create(userId, {
      title: draft.title,
      targetAmount: draft.targetCents === null ? undefined : draft.targetCents / 100,
    })) as SavedGoal;
    return {
      text: goalCreatedText({ title: truncate(draft.title), targetCents: draft.targetCents }),
      data: { goalId: goal.id },
      resultRef: goal.id,
    };
  }

  /** Aporte cria a transferência no extrato, soma ao guardado e conclui a meta se bater o alvo (contrato D1). */
  private async applyContribution(userId: string, draft: ContributionDraft): Promise<AppliedAction> {
    if (draft.goalId === null || draft.amountCents === null) {
      throw new Error('rascunho de aporte incompleto');
    }
    const goal = (await this.goals.contribute(userId, draft.goalId, {
      amount: draft.amountCents / 100,
      date: `${draft.date}T00:00:00.000Z`,
      createTransaction: true,
    })) as SavedGoal;
    const currentCents = toCents(goal.currentAmount);
    const targetCents = goal.targetAmount === null ? null : toCents(goal.targetAmount);
    return {
      text: contributionDoneText({
        title: truncate(goal.title),
        amountCents: draft.amountCents,
        currentCents,
        targetCents,
        percent: percentOf(currentCents, targetCents),
        achieved: goal.status === 'ACHIEVED',
        toneSeed: draft.toneSeed,
      }),
      data: { goalId: goal.id },
      resultRef: goal.id,
    };
  }

  /**
   * Grava o evento com a chave idempotente. Violação em `appliedKey` = já aplicado: devolve null.
   * Violação em `messageId` = outra requisição com a mesma mensagem (reentrega concorrente) gravou
   * o evento dela primeiro. O rascunho já foi reivindicado por este pedido, então não pode se perder:
   * grava de novo sem o messageId (o evento da outra requisição segue segurando a deduplicação).
   */
  private async createAppliedEvent(args: {
    userId: string;
    channel: ConversationChannel;
    messageId: string | null;
    intent: string;
    appliedKey: string;
  }): Promise<{ id: string } | null> {
    const data = { ...args, outcome: ConversationOutcome.RECOGNIZED };
    try {
      return await this.prisma.conversationEvent.create({ data, select: { id: true } });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      if (args.messageId === null || violatedField(error, 'appliedKey')) {
        return null;
      }
    }
    try {
      return await this.prisma.conversationEvent.create({ data: { ...data, messageId: null }, select: { id: true } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  private async restoreSession(args: {
    userId: string;
    session: SessionRow;
    channel: ConversationChannel;
    now: Date;
  }): Promise<boolean> {
    const { userId, session, channel, now } = args;
    try {
      await this.prisma.conversationSession.create({
        data: {
          id: session.id,
          userId,
          channel,
          state: session.state,
          intent: session.intent,
          draft: session.draft as Prisma.InputJsonValue,
          version: session.version,
          expiresAt: new Date(now.getTime() + ttlFor(session.state)),
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  private async cancelSession(userId: string, session: SessionRow, messageId: string | null): Promise<ConversationReply> {
    await this.prisma.conversationSession.deleteMany({ where: { id: session.id, userId } });
    await this.recordEventRaw({
      userId,
      channel: session.channel,
      messageId,
      intent: session.intent,
      outcome: ConversationOutcome.CANCELLED,
    });
    return this.reply('CANCELLED', 'IDLE', REPLIES.cancelled);
  }

  private async expireSession(userId: string, session: SessionRow, messageId: string | null): Promise<ConversationReply> {
    await this.prisma.conversationSession.deleteMany({ where: { id: session.id, userId } });
    await this.recordEventRaw({
      userId,
      channel: session.channel,
      messageId,
      intent: session.intent,
      outcome: ConversationOutcome.EXPIRED,
    });
    return this.reply('EXPIRED', 'IDLE', REPLIES.expired);
  }

  // ---------- leituras (mesmos numeros das telas) ----------

  /**
   * Ponto único de leitura (contrato secao 5): qualquer falha de serviço vira ERROR genérico,
   * sem texto da mensagem e sem detalhe interno. Evento RECOGNIZED ou ERROR, sem texto.
   */
  private async runRead(input: ConversationInput, intent: IntentMatch, state: ConversationStateView): Promise<ConversationReply> {
    let read: ConversationReply;
    try {
      read = await this.answerRead({ userId: input.userId, intent, now: input.receivedAt });
    } catch (error) {
      // Só o id da intenção e o nome do erro: nunca a mensagem do erro, o texto do usuário ou valores.
      this.logger.warn(`Leitura falhou: intent=${intent.intent} erro=${error instanceof Error ? error.name : typeof error}`);
      await this.recordEvent(input, intent.intent, ConversationOutcome.ERROR);
      return this.reply('ERROR', state, REPLIES.consultError);
    }
    await this.recordEvent(input, intent.intent, ConversationOutcome.RECOGNIZED);
    return { ...read, state };
  }

  private async answerRead(args: { userId: string; intent: IntentMatch; now: Date }): Promise<ConversationReply> {
    const { userId, intent, now } = args;
    switch (intent.intent) {
      case 'upcoming_dues':
        return this.upcomingDuesReply(userId, now);
      case 'installments':
        return this.installmentsReply(userId);
      case 'fixed_bills':
        return this.fixedBillsReply(userId);
      case 'goals':
        return this.goalsReply(userId);
      case 'envelopes':
        return this.envelopesReply(userId, now);
      case 'balance': {
        const { finances } = await this.readFinances(userId);
        const balanceCents = toCents(finances.balance);
        return this.infoReply(balanceText(balanceCents), { balanceCents });
      }
      case 'month_summary': {
        const { finances } = await this.readFinances(userId);
        const incomeCents = toCents(finances.monthlyIncome);
        const expenseCents = toCents(finances.monthlyExpenses);
        const balanceCents = toCents(finances.balance);
        return this.infoReply(monthSummaryText(incomeCents, expenseCents, balanceCents), {
          incomeCents,
          expenseCents,
          balanceCents,
        });
      }
      case 'spend_total': {
        const { finances } = await this.readFinances(userId);
        const expenseCents = toCents(finances.monthlyExpenses);
        return this.infoReply(spendTotalText(expenseCents), { expenseCents });
      }
      case 'spend_by_category':
        return this.spendByCategory(userId, intent.categoryQuery);
      case 'credit_card':
        return this.creditCardReply(userId, intent.cardTerm);
      case 'list_cards':
        return this.listCardsReply(userId);
      case 'categories':
        return this.categoriesReply(userId);
      case 'help':
        return this.reply('HELP', 'IDLE', REPLIES.help);
      default:
        return this.reply('ERROR', 'IDLE', REPLIES.unrecognized);
    }
  }

  /** Categorias de despesa com o total do mes de cada uma (maior primeiro) e o que ficou sem categoria. */
  private async categoriesReply(userId: string): Promise<ConversationReply> {
    const { timezone } = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const month = monthToDateUtc(new Date(), timezone);
    const [grouped, categories] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, type: TransactionType.EXPENSE, date: { gte: month.start, lt: month.end } },
        _sum: { amount: true },
      }),
      this.prisma.financeCategory.findMany({
        where: { userId, type: TransactionType.EXPENSE },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    if (categories.length === 0) {
      return this.infoReply(CATEGORIES_EMPTY, { categories: [] });
    }
    const centsById = new Map(grouped.map((row) => [row.categoryId, toCents(row._sum.amount ?? 0)]));
    const rows = categories
      .map((category) => ({ name: truncate(category.name), cents: centsById.get(category.id) ?? 0 }))
      .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
    const shown = rows.slice(0, CATEGORIES_LIST_MAX);
    const uncategorizedCents = centsById.get(null) ?? 0;
    const text = categoriesListText({ rows: shown, hidden: rows.length - shown.length, uncategorizedCents });
    return this.infoReply(text, { categories: shown.map((row) => ({ name: row.name, amountCents: row.cents })) });
  }

  private async spendByCategory(userId: string, query: string): Promise<ConversationReply> {
    const { timezone } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const month = monthToDateUtc(new Date(), timezone);
    const [grouped, categories] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, type: TransactionType.EXPENSE, date: { gte: month.start, lt: month.end } },
        _sum: { amount: true },
      }),
      this.prisma.financeCategory.findMany({ where: { userId }, select: { id: true, name: true } }),
    ]);

    const matched = matchCategory(query, categories);
    if (matched.length === 0) {
      return this.infoReply(REPLIES.noCategoryMatch(query), { categories: [] });
    }
    const ids = new Set(matched.map((category) => category.id));
    const amountCents = grouped
      .filter((row) => row.categoryId !== null && ids.has(row.categoryId))
      .reduce((total, row) => total + toCents(row._sum.amount ?? 0), 0);
    const label = matched.length === 1 ? matched[0].name : query;
    return this.infoReply(categoryTotalText(label, amountCents), {
      categories: [{ name: label, amountCents }],
    });
  }

  /** Contas fixas de despesa ativas. Total mensal estimado: soma por mês, arredonda uma vez no total. */
  private async fixedBillsReply(userId: string): Promise<ConversationReply> {
    const all: RecurringRow[] = await this.recurring.list(userId);
    const bills = all
      .filter((row) => row.isActive === true && row.type === TransactionType.EXPENSE)
      .sort((a, b) => compareYmd(toYmd(a.nextDueDate), toYmd(b.nextDueDate)));
    if (bills.length === 0) {
      return this.infoReply(REPLIES.noFixedBills, { fixedBills: [], totalCents: 0 });
    }

    // Soma em doze avos de centavo (inteiros) e divide por 12 uma vez só: arredonda uma vez, sem erro de float.
    const totalCents = Math.round(bills.reduce((sum, row) => sum + monthlyTwelfths(row), 0) / MONTHS_PER_YEAR);
    const rows = bills.map((row) => ({
      label: truncate(row.description),
      frequency: row.frequency,
      amountCents: toCents(row.amount),
      nextDate: toYmd(row.nextDueDate),
    }));
    const shown = rows.slice(0, LIST_MAX_ITEMS);
    const text = fixedBillsText({ count: rows.length, rows: shown, hidden: rows.length - shown.length, totalCents });
    return this.infoReply(text, { fixedBills: shown, totalCents });
  }

  /** Parcelados ativos com parcela em aberto. Próximo impacto = parcela com a data mais próxima. */
  private async installmentsReply(userId: string): Promise<ConversationReply> {
    const all: InstallmentRow[] = await this.installments.list(userId);
    const open = all.filter((row) => row.isActive === true && row.remainingInstallments > 0);
    if (open.length === 0) {
      return this.infoReply(REPLIES.noInstallments, { installments: [], totalCents: 0 });
    }

    const rows = open
      .map((row) => ({
        label: truncate(row.description),
        number: row.installmentsGenerated + 1,
        total: row.installmentsTotal,
        amountCents: installmentCents(row),
        nextDate: row.nextDueDate ? toYmd(row.nextDueDate) : null,
      }))
      .sort((a, b) => compareYmdNullable(a.nextDate, b.nextDate));
    const totalCents = open.reduce((sum, row) => sum + toCents(row.remainingAmount), 0);
    const nextRow = rows.find((row) => row.nextDate !== null);
    const next = nextRow && nextRow.nextDate ? { amountCents: nextRow.amountCents, date: nextRow.nextDate } : null;
    const shown = rows.slice(0, LIST_MAX_ITEMS);
    const text = installmentsText({ count: rows.length, rows: shown, hidden: rows.length - shown.length, totalCents, next });
    return this.infoReply(text, { installments: shown, totalCents });
  }

  /**
   * Vencimentos da janela [hoje, hoje + 30 dias): contas fixas de despesa e parcelas, por data.
   * Usa só o próximo vencimento de cada conta, então conta semanal aparece uma vez.
   */
  private async upcomingDuesReply(userId: string, now: Date): Promise<ConversationReply> {
    const { timezone } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const today = localToday(now, timezone);
    const from = toYmd(today);
    const until = toYmd(addDaysUtc(today, UPCOMING_WINDOW_DAYS));
    const [recurring, installments] = await Promise.all([
      this.recurring.list(userId) as Promise<RecurringRow[]>,
      this.installments.list(userId) as Promise<InstallmentRow[]>,
    ]);

    const dues: DueItem[] = [
      ...recurring
        .filter((row) => row.isActive === true && row.type === TransactionType.EXPENSE)
        .map((row) => ({
          date: toYmd(row.nextDueDate),
          label: truncate(row.description),
          kind: 'FIXED' as const,
          tag: 'conta fixa',
          amountCents: toCents(row.amount),
        })),
      ...installments.flatMap((row) =>
        row.isActive === true && row.remainingInstallments > 0 && row.nextDueDate
          ? [
              {
                date: toYmd(row.nextDueDate),
                label: truncate(row.description),
                kind: 'INSTALLMENT' as const,
                tag: `parcela ${row.installmentsGenerated + 1}/${row.installmentsTotal}`,
                amountCents: installmentCents(row),
              },
            ]
          : [],
      ),
    ]
      .filter((item) => item.date >= from && item.date < until)
      .sort((a, b) => compareYmd(a.date, b.date) || b.amountCents - a.amountCents);

    if (dues.length === 0) {
      return this.infoReply(REPLIES.noDues(UPCOMING_WINDOW_DAYS), { dues: [], totalCents: 0 });
    }
    const totalCents = dues.reduce((sum, item) => sum + item.amountCents, 0);
    const shown = dues.slice(0, UPCOMING_MAX_ITEMS);
    const text = upcomingDuesText({
      days: UPCOMING_WINDOW_DAYS,
      count: dues.length,
      rows: shown,
      hidden: dues.length - shown.length,
      totalCents,
    });
    const data = shown.map(({ date, label, kind, amountCents }) => ({ date, label, kind, amountCents }));
    return this.infoReply(text, { dues: data, totalCents });
  }

  /** Metas ativas por data-alvo (sem data por último). Percentual = floor, teto 100%. */
  private async goalsReply(userId: string): Promise<ConversationReply> {
    const all: GoalRow[] = await this.goals.list(userId);
    const active = all
      .filter((goal) => goal.status === 'ACTIVE')
      .sort((a, b) => compareYmdNullable(dateOrNull(a.targetDate), dateOrNull(b.targetDate)));
    const otherCount = all.length - active.length;

    const rows = active.map((goal) => {
      const targetCents = goal.targetAmount === null ? null : toCents(goal.targetAmount);
      const hasTarget = targetCents !== null && targetCents > 0;
      const currentCents = toCents(goal.currentAmount);
      return {
        label: truncate(goal.title),
        currentCents,
        targetCents: hasTarget ? targetCents : null,
        percent: hasTarget ? Math.min(MAX_GOAL_PERCENT, Math.floor((currentCents * 100) / targetCents)) : null,
        targetDate: dateOrNull(goal.targetDate),
      };
    });
    const shown = rows.slice(0, LIST_MAX_ITEMS);
    const text = goalsText({ count: rows.length, rows: shown, hidden: rows.length - shown.length, otherCount });
    return this.infoReply(text, { goals: shown });
  }

  /**
   * Reservas ativas (envelopes), contrato 3b1 parte A. Usa EnvelopesService.list, que também gera
   * os depósitos atrasados, como abrir a tela. Total = soma do disponível das ativas (com sinal).
   */
  private async envelopesReply(userId: string, now: Date): Promise<ConversationReply> {
    const all = (await this.envelopes.list(userId, now)) as EnvelopeRow[];
    const active = all.filter((envelope) => envelope.isActive);
    const rows = active.map((envelope) => ({
      label: truncate(envelope.name),
      monthlyCents: toCents(envelope.monthlyAmount),
      availableCents: toCents(envelope.available),
      spentCents: toCents(envelope.spent),
    }));
    const totalAvailableCents = rows.reduce((total, row) => total + row.availableCents, 0);
    const shown = rows.slice(0, LIST_MAX_ITEMS);
    const text = envelopesText({
      count: rows.length,
      rows: shown,
      hidden: rows.length - shown.length,
      totalAvailableCents,
      pausedCount: all.length - active.length,
    });
    return this.infoReply(text, { envelopes: shown, totalCents: totalAvailableCents });
  }

  /** Mesmos numeros da tela inicial: DashboardService.getSummary, sem reescrever a formula. */
  private async readFinances(userId: string): Promise<DashboardFinances> {
    return (await this.dashboard.getSummary(userId)) as DashboardFinances;
  }

  private infoReply(text: string, data: ReplyData): ConversationReply {
    return { kind: 'INFO', state: 'IDLE', text, data };
  }

  // ---------- categorias e rascunho ----------

  /** Escolhe categoria pela descrição: unica = define; varias ou nenhuma = pergunta. */
  /** Cartoes ativos do dono, na ordem do 8d (padrao primeiro, depois nome). Sempre pelo userId do vinculo. */
  /**
   * Leitura por cartao (9b-2). Sem nome: cartao padrao, como antes. Com nome: o cartao do dono que casa;
   * nome que nao casa ou casa mais de um responde a lista (nunca erro). Sempre pelo userId do vinculo.
   */
  private async creditCardReply(userId: string, cardTerm?: string): Promise<ConversationReply> {
    if (cardTerm === undefined) {
      const card = cycleCardView(await this.creditCycle.getCurrent(userId));
      return this.infoReply(cardText(card), { card });
    }
    const cards = await this.activeCards(userId);
    if (cards.length === 0) return this.infoReply(CARD_READ_REPLIES.none, {});
    const hits = matchCardsByTerm(cards, cardTerm);
    const names = cards.map((card) => card.name);
    if (hits.length === 0) return this.infoReply(CARD_READ_REPLIES.notFound(cardTerm, names), {});
    if (hits.length > 1) return this.infoReply(CARD_READ_REPLIES.ambiguous(cardTerm, hits.map((card) => card.name)), {});
    const [chosen] = hits;
    const view = cycleCardView(await this.creditCycle.getCycleForCard(userId, chosen.id));
    return this.infoReply(namedCardText(chosen.name, cardText(view)), { card: view });
  }

  /** "Meus cartoes": so leitura, cartoes ativos do dono (padrao primeiro, depois nome). */
  private async listCardsReply(userId: string): Promise<ConversationReply> {
    const cards = await this.prisma.creditCard.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { name: true, isDefault: true, closingDay: true, dueDay: true },
    });
    return this.infoReply(cardListText(cards), {});
  }

  /**
   * Forma sem a palavra cartao ("limite do X", "quanto sobrou no X", "fatura do X") so vira leitura com nome EXATO
   * de cartao do dono; senao devolve null e segue o caminho de hoje (ajuda ou IA), como antes da 9b-2.
   */
  private async resolveLooseCardRead(userId: string, intent: IntentMatch | null): Promise<IntentMatch | null> {
    if (!intent || !('loose' in intent) || intent.loose !== true) return intent;
    const term = normalize(intent.cardTerm ?? '');
    const exact = (await this.activeCards(userId)).filter((card) => normalize(card.name) === term);
    return exact.length === 1 ? { intent: 'credit_card', cardTerm: intent.cardTerm } : null;
  }

  private async activeCards(userId: string): Promise<ChatCard[]> {
    return this.prisma.creditCard.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isDefault: true },
    });
  }

  /** Opcoes da escolha de cartao, na ordem em que foram oferecidas. */
  private async cardChoiceOptions(userId: string, draft: ExpenseOrIncomeDraft): Promise<ChatCard[]> {
    // Na ordem em que foram oferecidas (o numero que o usuario viu), nao na do 8d: o padrao pode mudar no meio da conversa.
    const offered = draft.cardOptions ?? [];
    const active = await this.activeCards(userId);
    return offered.flatMap((id) => active.filter((card) => card.id === id));
  }

  private async resolveCategory(userId: string, draft: ExpenseOrIncomeDraft, query: string): Promise<void> {
    const categories = await this.prisma.financeCategory.findMany({
      where: { userId, type: draft.type },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const matched = matchCategory(query, categories);
    if (matched.length === 1) {
      draft.categoryId = matched[0].id;
      draft.pendingField = null;
      draft.categoryOptions = [];
      return;
    }
    draft.categoryId = null;
    draft.pendingField = 'category';
    draft.categoryOptions =
      matched.length > 0
        ? matched.slice(0, MAX_CATEGORY_OPTIONS).map((category) => category.id)
        : categories.slice(0, MAX_CATEGORY_LIST).map((category) => category.id);
  }

  /** Resposta da pergunta de categoria. Não casou = sem categoria (não fica em loop). */
  private async pickCategoryAnswer(userId: string, draft: ExpenseOrIncomeDraft, answer: string): Promise<string | null> {
    const normalized = normalize(answer);
    if (normalized === 'sem categoria') {
      return null;
    }
    if (/^\d{1,2}$/.test(normalized) && draft.categoryOptions[Number(normalized) - 1]) {
      return draft.categoryOptions[Number(normalized) - 1];
    }
    const categories = await this.prisma.financeCategory.findMany({
      where: { userId, type: draft.type },
      select: { id: true, name: true },
    });
    const pool = draft.categoryOptions.length > 0
      ? categories.filter((category) => draft.categoryOptions.includes(category.id))
      : categories;
    const inOptions = matchCategory(answer, pool);
    if (inOptions.length === 1) return inOptions[0].id;
    // Fora das opcoes mostradas (lista cortada em 10): o nome inteiro ainda vale.
    const anywhere = matchCategory(answer, categories);
    return anywhere.length === 1 ? anywhere[0].id : null;
  }

  /** Resposta com o rascunho atual. prefix vai antes do texto; question troca a pergunta de campo. */
  private async draftReply(
    session: SessionRow,
    today: string,
    options: { prefix?: string; question?: string } = {},
  ): Promise<ConversationReply> {
    const draft = session.draft as unknown as SessionDraft;
    const view = await this.toDraftView(session);
    if (session.state === ConversationState.COLLECTING_FIELDS) {
      const question = options.question ?? (await this.questionFor(session.userId, draft));
      return {
        kind: 'ASK_FIELD',
        state: ConversationState.COLLECTING_FIELDS,
        text: [options.prefix, question].filter(Boolean).join('\n'),
        draft: view,
      };
    }
    const body = await this.confirmationText(session, draft, today, view);
    return {
      kind: 'CONFIRM_DRAFT',
      state: ConversationState.AWAITING_CONFIRMATION,
      text: [options.prefix, body].filter(Boolean).join('\n'),
      draft: view,
      quickReplies: isDeleteChange(draft) ? ['apagar', 'cancelar'] : isClearLimitDraft(draft) ? ['limpar', 'cancelar'] : ['confirmar', 'cancelar'],
    };
  }

  /** Texto do rascunho pronto para confirmar, por tipo. */
  private async confirmationText(
    session: SessionRow,
    draft: SessionDraft,
    today: string,
    view: DraftView,
  ): Promise<string> {
    if (isTransactionChangeDraft(draft)) {
      return this.transactionChangeText(session.userId, draft);
    }
    if (isTargetChangeDraft(draft)) {
      return this.targetChangeText(session.userId, draft);
    }
    if (draft.kind === 'ENVELOPE') {
      return envelopeDraftText({
        name: draft.name ?? 'a informar',
        monthlyCents: draft.monthlyCents ?? 0,
        provisionMonth: draft.provisionMonth,
      });
    }
    if (draft.kind === 'CARD_CREATE') {
      return cardCreateDraftText(draft);
    }
    if (draft.kind === 'CARD_RENAME') {
      return cardRenameDraftText({ from: draft.currentName, to: draft.newName });
    }
    if (draft.kind === 'CREDIT_LIMIT') {
      return draft.action === 'clear'
        ? creditLimitClearDraftText({ previousCents: draft.previousCeilingCents ?? 0, cycleEnd: draft.cycleEnd, cardName: draft.cardName })
        : creditLimitDraftText({ ceilingCents: draft.ceilingCents ?? 0, cycleEnd: draft.cycleEnd, cardName: draft.cardName });
    }
    if (draft.kind === 'RECURRING') {
      return recurringDraftText({
        description: draft.description ?? 'a informar',
        amountCents: draft.amountCents ?? 0,
        frequency: draft.frequency,
        firstDueDate: draft.firstDueDate ?? today,
      });
    }
    if (draft.kind === 'INSTALLMENT') {
      return installmentDraftText({
        description: draft.description ?? 'a informar',
        totalCents: draft.totalCents ?? 0,
        installmentsTotal: draft.installmentsTotal ?? 0,
        firstDueDate: draft.firstDueDate ?? today,
        toneSeed: toneSeedOf(draft),
      });
    }
    if (draft.kind === 'GOAL') {
      return goalDraftText({ title: truncate(draft.title ?? ''), targetCents: draft.targetCents });
    }
    if (draft.kind === 'CONTRIBUTION') {
      const goal = await this.snapshotOf(session.userId, draft.goalId);
      const amountCents = draft.amountCents ?? 0;
      return contributionDraftText({
        meta: this.contributionGoalLabel(draft, goal),
        title: truncate(goal?.title ?? draft.goalTitle ?? ''),
        amountCents,
        date: draft.date,
        concludes: goal !== null && concludesGoal(goal, amountCents),
        toneSeed: toneSeedOf(draft),
      });
    }
    if (draft.kind === 'CARD_PICK') {
      return CARD_WRITE_REPLIES.pickHeader;
    }
    if (draft.kind === 'CATEGORY_CREATE') {
      return categoryCreateDraftText({ name: draft.name, type: draft.type });
    }
    if (draft.kind === 'CATEGORY_CHANGE') {
      return this.categoryChangeDraftText(session.userId, draft);
    }
    return draftText({
      type: draft.type,
      amountCents: draft.amountCents,
      description: draft.description ?? '',
      category: view.category,
      date: draft.date,
      paymentMethod: draft.paymentMethod,
      cardName: draft.cardName ?? null,
      futureDate: draft.date > today,
      toneSeed: toneSeedOf(draft),
    });
  }

  private async questionFor(userId: string, draft: SessionDraft): Promise<string> {
    if (isTransactionChangeDraft(draft)) {
      if (draft.pendingField === 'change') return TX_REPLIES.askChange;
      if (draft.candidateIds.length === 0) return TX_REPLIES.askWhich;
      return this.transactionListText(userId, draft);
    }
    if (isTargetChangeDraft(draft)) {
      if (draft.pendingField === 'change') {
        return draft.kind === 'GOAL_CHANGE'
          ? TG_REPLIES.askChangeGoal
          : draft.kind === 'ENVELOPE_CHANGE'
            ? TG_REPLIES.askChangeEnvelope
            : RC_REPLIES.askChangeRecurring;
      }
      if (draft.candidateIds.length === 0) {
        return draft.kind === 'GOAL_CHANGE'
          ? TG_REPLIES.askWhichGoal
          : draft.kind === 'ENVELOPE_CHANGE'
            ? TG_REPLIES.askWhichEnvelope
            : draft.kind === 'RECURRING_CHANGE'
              ? RC_REPLIES.askWhichRecurring
              : RC_REPLIES.askWhichInstallment;
      }
      return this.targetListText(userId, draft.kind, draft.candidateIds);
    }
    if (draft.kind === 'RECURRING') {
      if (draft.pendingField === 'description') return REPLIES.askDraftDescription;
      if (draft.pendingField === 'amount') return REPLIES.askRecurringAmount;
      return REPLIES.askFirstDue;
    }
    if (draft.kind === 'INSTALLMENT') {
      if (draft.pendingField === 'description') return REPLIES.askDraftDescription;
      if (draft.pendingField === 'amount') return REPLIES.askInstallmentTotal;
      if (draft.pendingField === 'installmentsTotal') return REPLIES.askInstallmentsTotal;
      return REPLIES.askFirstDue;
    }
    if (draft.kind === 'ENVELOPE') {
      return draft.pendingField === 'name' ? REPLIES.askEnvelopeName : REPLIES.askEnvelopeAmount;
    }
    if (draft.kind === 'CARD_CREATE') {
      return draft.pendingField === 'name' ? CARD_WRITE_REPLIES.askName : CARD_WRITE_REPLIES.askClosingDay(draft.name ?? '');
    }
    if (draft.kind === 'CARD_PICK') {
      return draft.pendingField === 'card' ? this.cardPickText(userId, draft) : CARD_WRITE_REPLIES.askNewName(draft.cardName ?? '');
    }
    if (draft.kind === 'CATEGORY_CREATE') {
      return draft.pendingField === 'type' ? CATEGORY_REPLIES.askType : CATEGORY_REPLIES.askName;
    }
    if (draft.kind === 'CATEGORY_CHANGE') {
      if (draft.pendingField === 'category') return this.categoryPickText(userId, draft);
      const target = draft.targetId === null ? null : await this.prisma.financeCategory.findFirst({ where: { id: draft.targetId, userId }, select: { name: true } });
      return CATEGORY_REPLIES.askNewName(target?.name ?? '');
    }
    if (draft.kind === 'CARD_RENAME') {
      return REPLIES.collectingReminder;
    }
    if (draft.kind === 'CREDIT_LIMIT') {
      return creditLimitQuestion(draft);
    }
    if (draft.kind === 'GOAL') {
      return draft.pendingField === 'title' ? REPLIES.askGoalTitle : REPLIES.askGoalTarget;
    }
    if (draft.kind === 'CONTRIBUTION') {
      if (draft.pendingField === 'amount') {
        return REPLIES.askContributionAmount;
      }
      const pool = await this.optionGoals(userId, draft.goalOptions);
      return goalOptionsText(draft.goalOptions.map((id) => {
        const goal = pool.find((candidate) => candidate.id === id);
        return goal ? truncate(goal.title) : 'indisponível';
      }));
    }
    if (draft.pendingField === 'amount') {
      return REPLIES.askAmount;
    }
    if (draft.pendingField === 'description') {
      return REPLIES.askDescription;
    }
    if (draft.pendingField === 'card') {
      const options = await this.cardChoiceOptions(userId, draft);
      return CARD_EXPENSE_REPLIES.choose(options.map((card) => card.name));
    }
    if (draft.categoryOptions.length === 0) {
      return REPLIES.askCategoryNoOptions;
    }
    const names = await this.categoryNames(userId, draft.categoryOptions);
    return categoryOptionsText(names);
  }

  /**
   * Rascunho para a tela (contrato 3b1, secao 4). Lançamento mantém os campos antigos preenchidos;
   * meta e aporte deixam os campos de lançamento nulos e a tela lê só `rows`.
   */
  private async toDraftView(session: SessionRow): Promise<DraftView> {
    const draft = session.draft as unknown as SessionDraft;
    const base = {
      draftId: session.id,
      draftVersion: session.version,
      type: TransactionType.EXPENSE,
      amount: null,
      description: null,
      category: null,
      date: null,
      paymentMethod: null,
    };

    if (isTransactionChangeDraft(draft)) {
      // Prévia exata (contrato 8a, secoes 4 e 5): o lançamento escolhido é relido com id + userId da sessão.
      // Apagar mostra o lançamento; editar mostra "antes -> depois" só dos campos que mudam. Inelegível ou sumido: linha neutra.
      const editing = draft.action === 'EDIT' && Object.keys(draft.changes).length > 0;
      const loaded =
        draft.targetId !== null && (draft.action === 'DELETE' || editing)
          ? await this.loadTxCandidate(session.userId, draft.targetId)
          : null;
      const target = loaded?.eligible === true ? loaded : null;
      let rows: DraftView['rows'] = [];
      if (target !== null) {
        rows =
          draft.action === 'DELETE'
            ? [
                { label: 'Valor', value: formatBrl(target.amountCents) },
                { label: 'Descrição', value: target.description },
                { label: 'Categoria', value: target.categoryName ?? 'sem categoria' },
                { label: 'Data', value: formatDmy(target.date) },
              ]
            : await this.changeDiffRows(session.userId, target, draft.changes);
      }
      return {
        ...base,
        kind: 'TRANSACTION_CHANGE',
        title: draft.action === 'DELETE' ? 'Apagar lançamento' : 'Editar lançamento',
        changeAction: draft.action,
        pendingField: draft.pendingField,
        rows: rows.length > 0 ? rows : [{ label: 'Lançamento', value: draft.targetId === null ? 'a escolher' : 'escolhido' }],
      };
    }

    if (isTargetChangeDraft(draft)) {
      // Prévia exata (contrato 8b, secoes 4 e 5): o alvo é relido com id + userId. Sumido: linha neutra; a aplicação recusa depois.
      const noun =
        draft.kind === 'GOAL_CHANGE'
          ? 'meta'
          : draft.kind === 'ENVELOPE_CHANGE'
            ? 'reserva'
            : draft.kind === 'RECURRING_CHANGE'
              ? 'conta fixa'
              : 'compra parcelada';
      const editing = draft.action === 'EDIT' && Object.keys(draft.changes).length > 0;
      const target =
        draft.targetId !== null && (draft.action === 'DELETE' || editing)
          ? await this.loadTargetCandidate(session.userId, draft.kind, draft.targetId)
          : null;
      const rows = target === null ? [] : this.targetRows(draft.kind, draft.action, target, draft.changes);
      const fallbackLabel =
        draft.kind === 'GOAL_CHANGE' ? 'Meta' : draft.kind === 'ENVELOPE_CHANGE' ? 'Reserva' : draft.kind === 'RECURRING_CHANGE' ? 'Conta fixa' : 'Compra parcelada';
      return {
        ...base,
        kind: draft.kind,
        title: `${draft.action === 'DELETE' ? 'Apagar' : 'Editar'} ${noun}`,
        changeAction: draft.action,
        pendingField: draft.pendingField,
        rows: rows.length > 0 ? rows : [{ label: fallbackLabel, value: draft.targetId === null ? 'a escolher' : 'escolhido' }],
      };
    }

    if (draft.kind === 'ENVELOPE') {
      return {
        ...base,
        kind: 'ENVELOPE',
        title: 'Reserva',
        pendingField: draft.pendingField,
        rows: [
          { label: 'Nome', value: draft.name ?? 'a informar' },
          { label: 'Valor mensal', value: draft.monthlyCents === null ? 'a informar' : formatBrl(draft.monthlyCents) },
          { label: 'Início', value: `${monthYearUtc(draft.provisionMonth)} (UTC)` },
          { label: 'Aviso', value: REPLIES.envelopeProvisionWarning },
          ...reviewRows(draft.reviewReason),
        ],
      };
    }
    if (draft.kind === 'CARD_PICK') {
      return {
        ...base,
        kind: 'CARD_PICK',
        title: draft.purpose === 'RENAME' ? 'Renomear cartão' : draft.purpose === 'SET_LIMIT' ? 'Definir limite' : 'Limpar limite',
        pendingField: null,
        rows: [{ label: 'Cartão', value: draft.cardName ?? 'a escolher' }],
      };
    }
    if (draft.kind === 'CATEGORY_CREATE') {
      return {
        ...base,
        kind: 'CATEGORY_CREATE',
        title: 'Criar categoria',
        pendingField: null,
        rows: [
          { label: 'Nome', value: draft.name ?? 'a informar' },
          { label: 'Tipo', value: draft.type === null ? 'a informar' : categoryTypeLabel(draft.type) },
        ],
      };
    }
    if (draft.kind === 'CATEGORY_CHANGE') {
      const target = draft.targetId === null ? null : await this.prisma.financeCategory.findFirst({ where: { id: draft.targetId, userId: session.userId }, select: { name: true } });
      return {
        ...base,
        kind: 'CATEGORY_CHANGE',
        title: draft.action === 'DELETE' ? 'Excluir categoria' : 'Editar categoria',
        changeAction: draft.action,
        pendingField: null,
        rows: [
          { label: 'Categoria', value: target?.name ?? 'a escolher' },
          ...(draft.action === 'EDIT' ? [{ label: 'Novo nome', value: draft.newName ?? 'a informar' }] : [{ label: 'Aviso', value: 'Os lançamentos dela ficam sem categoria.' }]),
        ],
      };
    }
    if (draft.kind === 'CARD_CREATE') {
      return {
        ...base,
        kind: 'CARD_CREATE',
        title: 'Criar cartão',
        pendingField: draft.pendingField,
        rows: [
          { label: 'Cartão', value: draft.name },
          { label: 'Fechamento', value: draft.closingDay === null ? 'a informar' : `dia ${draft.closingDay}` },
          { label: 'Vencimento', value: draft.dueDay === null ? 'sem vencimento' : `dia ${draft.dueDay}` },
          { label: 'Padrão', value: 'não' },
        ],
      };
    }
    if (draft.kind === 'CARD_RENAME') {
      return {
        ...base,
        kind: 'CARD_RENAME',
        title: 'Renomear cartão',
        pendingField: null,
        rows: [
          { label: 'Cartão', value: draft.currentName },
          { label: 'Novo nome', value: draft.newName },
        ],
      };
    }
    if (draft.kind === 'CREDIT_LIMIT') {
      const clear = draft.action === 'clear';
      return {
        ...base,
        kind: 'CREDIT_LIMIT',
        title: clear ? 'Limpar limite do cartão' : 'Limite do cartão',
        changeAction: clear ? 'CLEAR' : undefined,
        pendingField: draft.pendingField,
        rows: [
          ...(draft.cardName ? [{ label: 'Cartão', value: draft.cardName }] : []),
          { label: 'Ciclo', value: `${longDate(draft.cycleStart)} a ${longDate(draft.cycleEnd)}` },
          ...(clear
            ? [
                { label: 'Teto atual', value: draft.previousCeilingCents === null ? 'não definido' : formatBrl(draft.previousCeilingCents) },
                { label: 'Aviso', value: REPLIES.creditLimitClearWarning },
              ]
            : [
                { label: 'Limite atual', value: draft.previousCeilingCents === null ? 'não definido' : formatBrl(draft.previousCeilingCents) },
                { label: 'Novo limite', value: draft.ceilingCents === null ? 'a informar' : formatBrl(draft.ceilingCents) },
                { label: 'Aviso', value: REPLIES.creditLimitCycleWarning },
                ...(draft.countAllPayments ? [{ label: 'Aviso', value: REPLIES.creditLimitAllPaymentsWarning }] : []),
              ]),
          ...reviewRows(draft.reviewReason),
        ],
      };
    }
    if (draft.kind === 'RECURRING') {
      const today = await this.todayYmd(session.userId, new Date());
      return {
        ...base,
        kind: 'RECURRING',
        title: 'Conta fixa',
        pendingField: draft.pendingField,
        rows: [
          { label: 'Descrição', value: draft.description ?? 'a informar' },
          { label: 'Valor por vencimento', value: draft.amountCents === null ? 'a informar' : formatBrl(draft.amountCents) },
          { label: 'Frequência', value: FREQUENCY_ROW_LABEL[draft.frequency] },
          { label: 'Primeiro vencimento', value: draft.firstDueDate === null ? 'a informar' : longDate(draft.firstDueDate) },
          { label: 'Categoria', value: 'não informada' },
          { label: 'Forma de pagamento', value: 'não informada' },
          ...dueWarningRows(draft.firstDueDate, today, REPLIES.recurringTodayWarning),
          ...reviewRows(draft.reviewReason),
        ],
      };
    }
    if (draft.kind === 'INSTALLMENT') {
      const today = await this.todayYmd(session.userId, new Date());
      const split = draft.totalCents !== null && draft.installmentsTotal !== null
        ? splitInstallments(draft.totalCents, draft.installmentsTotal)
        : null;
      return {
        ...base,
        kind: 'INSTALLMENT',
        title: 'Compra parcelada',
        pendingField: draft.pendingField,
        rows: [
          { label: 'Descrição', value: draft.description ?? 'a informar' },
          { label: 'Total da compra', value: draft.totalCents === null ? 'a informar' : formatBrl(draft.totalCents) },
          { label: 'Quantidade', value: draft.installmentsTotal === null ? 'a informar' : String(draft.installmentsTotal) },
          { label: 'Valor por parcela', value: split ? formatBrl(split.installmentCents) : 'a informar' },
          { label: 'Última parcela', value: split ? formatBrl(split.lastInstallmentCents) : 'a informar' },
          { label: 'Primeiro vencimento', value: draft.firstDueDate === null ? 'a informar' : longDate(draft.firstDueDate) },
          { label: 'Categoria', value: 'não informada' },
          { label: 'Forma de pagamento', value: 'não informada' },
          ...dueWarningRows(draft.firstDueDate, today, REPLIES.installmentTodayWarning),
          ...reviewRows(draft.reviewReason),
        ],
      };
    }
    if (draft.kind === 'GOAL') {
      return {
        ...base,
        kind: 'GOAL',
        title: 'Meta',
        pendingField: draft.pendingField,
        rows: [
          { label: 'Nome', value: draft.title ? truncate(draft.title) : 'a informar' },
          { label: 'Alvo', value: goalTargetValue(draft) },
        ],
      };
    }
    if (draft.kind === 'CONTRIBUTION') {
      const goal = await this.snapshotOf(session.userId, draft.goalId);
      return {
        ...base,
        kind: 'CONTRIBUTION',
        title: 'Aporte',
        pendingField: draft.pendingField,
        rows: [
          { label: 'Meta', value: this.contributionGoalLabel(draft, goal) },
          { label: 'Valor', value: draft.amountCents === null ? 'a informar' : formatBrl(draft.amountCents) },
          { label: 'Data', value: longDate(draft.date) },
          ...(goal !== null && concludesGoal(goal, draft.amountCents ?? 0)
            ? [{ label: 'Aviso', value: 'Este aporte conclui a meta.' }]
            : []),
        ],
      };
    }

    const category = draft.categoryId
      ? (await this.prisma.financeCategory.findFirst({
          where: { id: draft.categoryId, userId: session.userId },
          select: { name: true },
        }))?.name ?? null
      : null;
    const amount = draft.pendingField === 'amount' ? 'a informar' : formatBrl(draft.amountCents);
    return {
      ...base,
      kind: 'TRANSACTION',
      title: 'Lançamento',
      type: draft.type,
      amount,
      description: draft.description,
      category,
      date: draft.date,
      paymentMethod: draft.paymentMethod,
      pendingField: draft.pendingField,
      rows: [...transactionRows({
        amount,
        description: draft.description ?? 'a informar',
        category: category ?? (draft.pendingField === 'category' ? 'a informar' : 'sem categoria'),
        date: draft.date,
        paymentMethod: draft.paymentMethod,
      }), ...(draft.cardName ? [{ label: 'Cartão', value: draft.cardName }] : []), ...(draft.date > await this.todayYmd(session.userId, new Date())
        ? [{ label: 'Aviso', value: 'Este lançamento tem data futura.' }]
        : [])],
    };
  }

  /** Nome da meta do aporte com o guardado e o alvo quando a meta ainda existe. */
  private contributionGoalLabel(draft: ContributionDraft, goal: GoalSnap | null): string {
    if (goal) {
      return goalLabel({ title: truncate(goal.title), currentCents: goal.currentCents, targetCents: goal.targetCents });
    }
    return draft.goalTitle ? truncate(draft.goalTitle) : 'a informar';
  }

  /** Estado atual da meta do aporte (lido agora, não congelado no rascunho). */
  private async snapshotOf(userId: string, goalId: string | null): Promise<GoalSnap | null> {
    if (goalId === null) {
      return null;
    }
    const goals = await this.listGoals(userId);
    return goals.find((goal) => goal.id === goalId) ?? null;
  }

  /** Metas da conta, qualquer status, em centavos. Só as com userId da conta (defesa em profundidade). */
  private async listGoals(userId: string): Promise<GoalSnap[]> {
    const all = (await this.goals.list(userId)) as OwnedGoalRow[];
    return all
      .filter((goal) => goal.userId === userId)
      .map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        targetCents: goal.targetAmount === null ? null : toCents(goal.targetAmount),
        currentCents: toCents(goal.currentAmount),
      }));
  }

  private async activeGoals(userId: string): Promise<GoalSnap[]> {
    return (await this.listGoals(userId)).filter((goal) => goal.status === 'ACTIVE');
  }

  /** Opções da pergunta de meta, na ordem oferecida; meta que deixou de estar ativa sai da lista. */
  private async optionGoals(userId: string, ids: string[]): Promise<GoalSnap[]> {
    const active = await this.activeGoals(userId);
    return ids.map((id) => active.find((goal) => goal.id === id)).filter((goal): goal is GoalSnap => goal !== undefined);
  }

  private async isGoalNameTaken(userId: string, title: string): Promise<boolean> {
    const target = normalize(title);
    return (await this.activeGoals(userId)).some((goal) => normalize(goal.title) === target);
  }

  private async categoryNames(userId: string, ids: string[]): Promise<string[]> {
    const rows = await this.prisma.financeCategory.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, name: true },
    });
    return ids.map((id) => rows.find((row) => row.id === id)?.name ?? '');
  }

  // ---------- utilitarios ----------

  private async loadSession(userId: string, channel: ConversationChannel): Promise<SessionRow | null> {
    return this.prisma.conversationSession.findFirst({ where: { userId, channel } });
  }

  private async greetingOf(userId: string, now: Date): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    return greetingFor(now, user.timezone);
  }

  private async todayYmd(userId: string, now: Date): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    return localToday(now, user.timezone).toISOString().slice(0, 10);
  }

  private stateView(session: { state: ConversationState } | null): ConversationStateView {
    return session ? session.state : 'IDLE';
  }

  private reply(kind: ConversationReplyKind, state: ConversationStateView, text: string): ConversationReply {
    return { kind, state, text };
  }

  /** Evento sem texto da mensagem (decisao D6). Repeticao de messageId ignorada: outra requisicao já gravou. */
  private async recordEvent(
    input: ConversationInput,
    intent: string | null,
    outcome: ConversationOutcome,
  ): Promise<void> {
    await this.recordEventRaw({
      userId: input.userId,
      channel: input.channel,
      messageId: input.messageId,
      intent,
      outcome,
    });
  }

  private async recordEventRaw(args: {
    userId: string;
    channel: ConversationChannel;
    messageId: string | null;
    intent: string | null;
    outcome: ConversationOutcome;
  }): Promise<void> {
    try {
      await this.prisma.conversationEvent.create({
        data: {
          userId: args.userId,
          channel: args.channel,
          messageId: args.messageId,
          intent: args.intent,
          outcome: args.outcome,
        },
      });
    } catch (error) {
      if (args.messageId !== null && isUniqueViolation(error)) {
        return;
      }
      throw error;
    }
  }
}

/** Campos lidos do lançamento para editar/apagar (id + userId sempre no where). */
const TX_SELECT = {
  id: true,
  type: true,
  description: true,
  amount: true,
  date: true,
  createdAt: true,
  updatedAt: true,
  categoryId: true,
  recurringTransactionId: true,
  installmentPurchaseId: true,
  linkedGoalId: true,
  receiptScan: { select: { id: true } },
  category: { select: { name: true } },
} as const;

/** Teto de linhas lidas na busca (janela de 180 dias). */
const TX_SEARCH_LIMIT = 2000;

/** Campos do editar/apagar meta e reserva (contrato 8b): o mínimo para listar, prévia e conflito. */
const GOAL_CHANGE_SELECT = {
  id: true,
  title: true,
  status: true,
  targetAmount: true,
  currentAmount: true,
  targetDate: true,
  updatedAt: true,
} as const;

const ENVELOPE_CHANGE_SELECT = {
  id: true,
  name: true,
  monthlyAmount: true,
  isActive: true,
  updatedAt: true,
} as const;

const RECURRING_CHANGE_SELECT = {
  id: true,
  description: true,
  amount: true,
  frequency: true,
  nextDueDate: true,
  endDate: true,
  isActive: true,
  card: { select: { name: true } },
  updatedAt: true,
} as const;

const INSTALLMENT_CHANGE_SELECT = {
  id: true,
  description: true,
  installmentAmount: true,
  totalAmount: true,
  installmentsTotal: true,
  installmentsGenerated: true,
  nextDueDate: true,
  isActive: true,
  card: { select: { name: true } },
  updatedAt: true,
} as const;

type GoalChangeRow = {
  id: string;
  title: string;
  status: GoalCandidate['status'];
  targetAmount: Prisma.Decimal | null;
  currentAmount: Prisma.Decimal;
  targetDate: Date | null;
  updatedAt: Date;
};

type EnvelopeChangeRow = {
  id: string;
  name: string;
  monthlyAmount: Prisma.Decimal;
  isActive: boolean;
  updatedAt: Date;
};

function toGoalCandidateRow(row: GoalChangeRow): GoalCandidate {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    targetCents: row.targetAmount === null ? null : toCents(row.targetAmount),
    currentCents: toCents(row.currentAmount),
    targetDate: row.targetDate === null ? null : row.targetDate.toISOString().slice(0, 10),
    updatedAt: row.updatedAt,
  };
}

function toEnvelopeCandidateRow(row: EnvelopeChangeRow): EnvelopeCandidate {
  return {
    id: row.id,
    name: row.name,
    monthlyCents: toCents(row.monthlyAmount),
    isActive: row.isActive,
    updatedAt: row.updatedAt,
  };
}

type RecurringChangeRow = {
  id: string;
  description: string;
  amount: Prisma.Decimal;
  frequency: RecurringCandidate['frequency'];
  nextDueDate: Date;
  endDate: Date | null;
  isActive: boolean;
  card: { name: string } | null;
  updatedAt: Date;
};

function toRecurringCandidateRow(row: RecurringChangeRow): RecurringCandidate {
  return {
    id: row.id,
    description: row.description,
    amountCents: toCents(row.amount),
    frequency: row.frequency,
    nextDueDate: row.nextDueDate.toISOString().slice(0, 10),
    endDate: row.endDate === null ? null : row.endDate.toISOString().slice(0, 10),
    isActive: row.isActive,
    cardName: row.card?.name ?? null,
    updatedAt: row.updatedAt,
  };
}

type InstallmentChangeRow = {
  id: string;
  description: string;
  installmentAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  installmentsTotal: number;
  installmentsGenerated: number;
  nextDueDate: Date | null;
  isActive: boolean;
  card: { name: string } | null;
  updatedAt: Date;
};

function toInstallmentCandidateRow(row: InstallmentChangeRow): InstallmentCandidate {
  return {
    id: row.id,
    description: row.description,
    installmentCents: toCents(row.installmentAmount),
    totalCents: toCents(row.totalAmount),
    installmentsTotal: row.installmentsTotal,
    installmentsGenerated: row.installmentsGenerated,
    nextDueDate: row.nextDueDate === null ? null : row.nextDueDate.toISOString().slice(0, 10),
    isActive: row.isActive,
    cardName: row.card?.name ?? null,
    updatedAt: row.updatedAt,
  };
}

function toTxCandidate(row: {
  id: string;
  type: TransactionType;
  description: string;
  amount: { toString(): string };
  date: Date;
  createdAt: Date;
  updatedAt: Date;
  categoryId: string | null;
  recurringTransactionId: string | null;
  installmentPurchaseId: string | null;
  linkedGoalId: string | null;
  receiptScan: { id: string } | null;
  category: { name: string } | null;
}): TxCandidate {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    amountCents: Math.round(Number(row.amount.toString()) * 100),
    date: row.date.toISOString().slice(0, 10),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    // Decisao do dono em 2026-11-23: transferencia fica fora do editar/apagar por conversa
    // (editar uma errado mexe em duas contas). Busca, lista, escolha, aplicacao e previa usam esta flag.
    eligible:
      row.type !== 'TRANSFER' &&
      row.recurringTransactionId === null &&
      row.installmentPurchaseId === null &&
      row.linkedGoalId === null &&
      row.receiptScan === null,
  };
}

// ---------- funcoes puras do motor ----------

/** 'AAAA-MM-DD' vira 'dd/mm/aaaa'. */
function formatDmy(ymd: string): string {
  return ymd.split('-').reverse().join('/');
}

function isReadIntent(match: IntentMatch): boolean {
  return match.intent === 'spend_by_category' || (READ_INTENTS as string[]).includes(match.intent);
}

/** Número (ou "32,90 padaria") em resposta a "Quanto foi?" / "Quanto quer guardar?". Texto sem valor cai no erro de valor. */
function isAmountAnswer(text: string, draft: SessionDraft): boolean {
  // "1500" sozinho casaria create_expense; com o alvo da meta pendente é resposta, não lançamento.
  const awaitsAmount = draft.pendingField === 'amount' || (draft.kind === 'GOAL' && draft.pendingField === 'target');
  if (!awaitsAmount) {
    return false;
  }
  const parsed = parseAmountPrefix(text.trim());
  return parsed.ok === true || parsed.reason !== 'NOT_AMOUNT';
}

/** Número 1 a 5 que escolhe uma opção oferecida (categoria ou meta do aporte). */
function isOptionNumber(words: string, draft: SessionDraft): boolean {
  return /^[1-5]$/.test(words) && numberedOptions(draft)[Number(words) - 1] !== undefined;
}

function numberedOptions(draft: SessionDraft): string[] {
  if (isTransactionChangeDraft(draft)) {
    return [];
  }
  if (isTargetChangeDraft(draft)) {
    return [];
  }
  if (draft.kind === 'GOAL' || draft.kind === 'ENVELOPE' || draft.kind === 'CREDIT_LIMIT' || draft.kind === 'RECURRING' || draft.kind === 'INSTALLMENT' || draft.kind === 'CARD_RENAME' || draft.kind === 'CARD_CREATE' || draft.kind === 'CATEGORY_CREATE' || draft.kind === 'CATEGORY_CHANGE' || draft.kind === 'CARD_PICK') {
    return [];
  }
  if (draft.kind === 'CONTRIBUTION') {
    return draft.pendingField === 'goal' ? draft.goalOptions : [];
  }
  if (draft.pendingField === 'card') return draft.cardOptions ?? [];
  return draft.pendingField === 'category' ? draft.categoryOptions : [];
}

function draftKind(draft: SessionDraft): DraftKind {
  return draft.kind ?? 'TRANSACTION';
}

/** Próximo campo do aporte: meta antes do valor (a meta define o que se guarda). */
function nextContributionPending(goalId: string | null, amountCents: number | null): 'goal' | 'amount' | null {
  if (goalId === null) {
    return 'goal';
  }
  return amountCents === null ? 'amount' : null;
}

/** Depois do nome, falta o alvo se o usuário ainda não respondeu (nem "sem alvo"). */
function nextGoalPending(draft: GoalDraft): 'target' | null {
  return draft.targetCents === null && !draft.noTarget ? 'target' : null;
}

/** Busca meta pelo título: igualdade, depois prefixo, depois "contém" (contrato 3b1, secao 3). Sem acento e caixa. */
function matchGoalByTitle<T extends { title: string }>(query: string, goals: T[]): T[] {
  const target = normalize(query);
  if (target.length === 0) {
    return [];
  }
  const names = goals.map((goal) => normalize(goal.title));
  const tiers: Array<(name: string) => boolean> = [
    (name) => name === target,
    (name) => name.startsWith(target),
    (name) => name.includes(target),
  ];
  for (const tier of tiers) {
    const found = goals.filter((_, index) => tier(names[index]));
    if (found.length > 0) {
      return found;
    }
  }
  return [];
}

/**
 * "Este aporte conclui a meta" com a mesma conta do GoalsService.contribute (reais em ponto flutuante:
 * `atual + aporte >= alvo`). Em centavos inteiros o aviso poderia divergir do status gravado (0,7 + 0,1 < 0,8).
 */
function concludesGoal(goal: GoalSnap, amountCents: number): boolean {
  if (goal.targetCents === null) {
    return false;
  }
  return goal.currentCents / 100 + amountCents / 100 >= goal.targetCents / 100;
}

/** Meta com alvo: percentual com floor, teto 100%. Sem alvo: null. */
function percentOf(currentCents: number, targetCents: number | null): number | null {
  if (targetCents === null || targetCents <= 0) {
    return null;
  }
  return Math.min(MAX_GOAL_PERCENT, Math.floor((currentCents * 100) / targetCents));
}

/** Valor da linha "Alvo" na tela de meta. */
function goalTargetValue(draft: GoalDraft): string {
  if (draft.noTarget) {
    return 'sem alvo (cofrinho)';
  }
  return draft.targetCents === null ? 'a informar' : formatBrl(draft.targetCents);
}

/** Texto que começa com número é a resposta pedida (nome, descrição, quantidade ou data), não um comando (contrato 4). */
function startsWithNumericAnswer(draft: SessionDraft): boolean {
  if (draft.kind === 'CARD_CREATE') return draft.pendingField === 'closingDay' || draft.pendingField === 'name';
  if (draft.kind === 'CARD_PICK') return true;
  if (draft.kind === 'CATEGORY_CREATE') return draft.pendingField !== null;
  if (draft.kind === 'CATEGORY_CHANGE') return draft.pendingField === 'name';
  if (draft.kind === 'ENVELOPE') return draft.pendingField === 'name';
  if (draft.kind === 'RECURRING') return draft.pendingField === 'description' || draft.pendingField === 'firstDueDate';
  if (draft.kind === 'INSTALLMENT') {
    return draft.pendingField === 'description' || draft.pendingField === 'installmentsTotal' || draft.pendingField === 'firstDueDate';
  }
  return false;
}

/** Ordem da conta fixa: descrição, valor e primeiro vencimento (contrato 3b2, secao 4). */
function nextRecurringPending(draft: {
  description: string | null;
  amountCents: number | null;
  firstDueDate: string | null;
}): 'description' | 'amount' | 'firstDueDate' | null {
  if (draft.description === null) return 'description';
  if (draft.amountCents === null) return 'amount';
  if (draft.firstDueDate === null) return 'firstDueDate';
  return null;
}

/** Ordem do parcelado: descrição, total, quantidade e primeiro vencimento. */
function nextInstallmentPending(draft: {
  description: string | null;
  totalCents: number | null;
  installmentsTotal: number | null;
  firstDueDate: string | null;
}): 'description' | 'amount' | 'installmentsTotal' | 'firstDueDate' | null {
  if (draft.description === null) return 'description';
  if (draft.totalCents === null) return 'amount';
  if (draft.installmentsTotal === null) return 'installmentsTotal';
  if (draft.firstDueDate === null) return 'firstDueDate';
  return null;
}

/** Vencimento vindo do texto de abertura: null = ainda não informado (pergunta depois); erro = recusa sem rascunho. */
function openingDue(dueText: string | null, today: string): { ymd: string | null; error: string | null } {
  if (dueText === null || dueText === '') return { ymd: null, error: null };
  const due = resolveFirstDue(dueText, today);
  if (due.kind === 'DATE') return { ymd: due.ymd, error: null };
  if (due.kind === 'UNSUPPORTED') return { ymd: null, error: null };
  return { ymd: null, error: dueProblem(due) };
}

/** Texto da recusa de data (passada, longe demais ou inválida). UNSUPPORTED pede o formato aceito. */
function dueProblem(due: DueResolution): string {
  if (due.kind === 'INVALID') return REPLIES.invalidDate;
  if (due.kind === 'PAST') return REPLIES.firstDuePast;
  if (due.kind === 'TOO_FAR') return REPLIES.firstDueTooFar;
  return REPLIES.firstDueFormat;
}

/** Resposta de campo de data recusada: mantém o rascunho e pergunta de novo, com o motivo. */
function dueRefusal(due: DueResolution): PendingAnswer {
  return {
    status: 'ASK',
    outcome: due.kind === 'UNSUPPORTED' ? ConversationOutcome.UNRECOGNIZED : ConversationOutcome.ERROR,
    question: REPLIES.askFirstDue,
    prefix: dueProblem(due),
  };
}

/** Descrição de conta fixa ou parcelado: 2 a 120 caracteres. */
function descriptionRefusal(value: string, question: string): PendingAnswer | null {
  if (value.length < DESCRIPTION_MIN) {
    return { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question };
  }
  if (value.length > DESCRIPTION_MAX) {
    return { status: 'ERROR', text: REPLIES.descriptionTooLong };
  }
  return null;
}

/** Valor que deve ocupar a resposta inteira (sobra pede reenvio, como na reserva e no limite). */
function amountAnswer(value: string, question: string): { ok: true; cents: number } | { ok: false; answer: PendingAnswer } {
  const amount = parseAmountPrefix(value);
  if (amount.ok === false) {
    if (amount.reason === 'NOT_AMOUNT') {
      return { ok: false, answer: { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question, prefix: REPLIES.amountOnly } };
    }
    return { ok: false, answer: { status: 'ERROR', text: amountErrorText(amount.reason) } };
  }
  if (amount.rest !== '') {
    return { ok: false, answer: { status: 'ASK', outcome: ConversationOutcome.UNRECOGNIZED, question, prefix: REPLIES.amountOnly } };
  }
  return { ok: true, cents: amount.cents };
}

/** Texto de recusa do corpo de abertura (valor, quantidade ou total dado como parcela). */
function bodyErrorText(reason: BodyFailure): string {
  if (reason === 'QUANTITY') return REPLIES.installmentsRange;
  if (reason === 'TOTAL_ONLY') return REPLIES.installmentTotalOnly;
  return amountErrorText(reason);
}

/** Avisos do cartão de conta fixa e parcelado: geração de hoje ou nos vencimentos, e cadastros já vencidos. */
function dueWarningRows(firstDueDate: string | null, today: string, todayWarning: string): Array<{ label: string; value: string }> {
  if (firstDueDate === null) return [];
  const rows: Array<{ label: string; value: string }> = [];
  if (firstDueDate === today) {
    rows.push({ label: 'Aviso', value: todayWarning });
  } else if (firstDueDate > today) {
    rows.push({ label: 'Aviso', value: REPLIES.futureDueWarning });
  }
  rows.push({ label: 'Aviso', value: REPLIES.catchUpWarning });
  return rows;
}

/** Erro de commit desconhecido, vindo de qualquer um dos quatro domínios de gravação. */
/** Resposta de nome ou tipo da categoria nova: palavras como "Metas" ou "gastos" valem como resposta, nao como consulta. */
function isCategoryCreateAnswer(draft: SessionDraft, text: string, intent: IntentMatch | null): boolean {
  const looksLikeName = intent === null || isReadIntent(intent);
  if (draft.kind === 'CATEGORY_CREATE') {
    if (draft.pendingField === 'type') return parseCategoryType(text) !== null;
    return draft.pendingField === 'name' && looksLikeName;
  }
  if (draft.kind === 'CARD_CREATE') return draft.pendingField === 'name' && looksLikeName;
  if (draft.kind === 'CARD_PICK') return draft.pendingField === 'name' ? looksLikeName : looksLikeName || /^\d/.test(text);
  return false;
}

/** Pergunta do valor do teto; com cartao escolhido, diz qual. */
function creditLimitQuestion(draft: CreditLimitDraft): string {
  return draft.cardName ? `Qual o limite para este ciclo do cartão ${draft.cardName}?` : REPLIES.askCreditLimit;
}

/** Troca o conteudo do rascunho por outro tipo, mantendo o mesmo objeto (a sessao salva o que ficou nele). */
function replaceDraft(target: object, next: object): void {
  for (const key of Object.keys(target)) delete (target as Record<string, unknown>)[key];
  Object.assign(target, next);
}

/** Rascunho de gasto/receita que ainda nao recebeu nada alem do pedido do valor. */
function isAwaitingFirstAmount(draft: SessionDraft): boolean {
  const candidate = draft as Partial<ExpenseOrIncomeDraft>;
  const isTransaction = candidate.kind === undefined || candidate.kind === 'TRANSACTION';
  return isTransaction && candidate.pendingField === 'amount' && candidate.amountCents === 0 && candidate.description === null;
}

function isWriteUncertain(error: unknown): boolean {
  return (
    error instanceof EnvelopeWriteUncertainError ||
    error instanceof CreditLimitWriteUncertainError ||
    error instanceof RecurringWriteUncertainError ||
    error instanceof InstallmentWriteUncertainError ||
    error instanceof CreditCardWriteUncertainError ||
    error instanceof CategoryWriteUncertainError
  );
}

/** Erro que descarta o rascunho: limite do plano ou erro 4xx do serviço (D5). */
function isDiscardError(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() < 500;
}

/** Texto do rascunho descartado por erro 4xx. Limite do plano usa a mensagem da própria exceção. */
/** Confirmar uma ediçao sem nenhuma mudanca nao grava (contratos 8a e 8b): lançamento, meta ou reserva. */
function isEditWithoutChanges(draft: unknown): boolean {
  if (!isTransactionChangeDraft(draft) && !isTargetChangeDraft(draft)) {
    return false;
  }
  return draft.action === 'EDIT' && draft.targetId !== null && Object.keys(draft.changes).length === 0;
}

/** Cartao de leitura (9b-2 e padrao) a partir do ciclo: centavos, como a tela. */
function cycleCardView(cycle: Awaited<ReturnType<CreditCycleService['getCurrent']>>) {
  return {
    ceilingCents: cycle.ceiling === null ? null : toCents(cycle.ceiling),
    spentCents: toCents(cycle.spent),
    remainingCents: cycle.remaining === null ? null : toCents(cycle.remaining),
    percentUsed: cycle.percentUsed,
    closingDay: cycle.closingDay,
    dueDay: cycle.dueDay,
  };
}

function discardText(kind: DraftKind, error: unknown): string {
  if (error instanceof PlanLimitException) {
    return error.message;
  }
  if (kind === 'TRANSACTION_CHANGE') {
    // Lançamento sumiu ou mudou (404/409): a mensagem do motor já diz o que fazer.
    return error instanceof HttpException ? error.message : TX_REPLIES.gone;
  }
  if (kind === 'CATEGORY_CHANGE' || kind === 'CATEGORY_CREATE') {
    return error instanceof HttpException ? error.message : CATEGORY_REPLIES.gone;
  }
  if (kind === 'GOAL_CHANGE' || kind === 'ENVELOPE_CHANGE' || kind === 'RECURRING_CHANGE' || kind === 'INSTALLMENT_CHANGE') {
    // Alvo sumiu, mudou ou o dominio recusou (nome repetido etc.): mensagem conhecida passa; o resto e a do alvo sumido.
    return error instanceof HttpException
      ? error.message
      : kind === 'GOAL_CHANGE'
        ? TG_REPLIES.goalGone
        : kind === 'ENVELOPE_CHANGE'
          ? TG_REPLIES.envelopeGone
          : kind === 'RECURRING_CHANGE'
            ? RC_REPLIES.recurringGone
            : RC_REPLIES.installmentGone;
  }
  if (kind === 'ENVELOPE') {
    // Nome repetido (corrida com a tela): o domínio devolve a mensagem conhecida; as demais recusas são genéricas.
    return error instanceof HttpException && error.message === REPLIES.envelopeNameTaken
      ? REPLIES.envelopeNameTaken
      : REPLIES.envelopeRejected;
  }
  if (kind === 'CARD_CREATE') {
    // 9b-3b: recusa do CreditCardsService (teto ou nome tomado) vira texto claro; nada foi gravado (4xx).
    if (error instanceof HttpException) {
      if (error.getStatus() === 422) return CARD_WRITE_REPLIES.createLimit(MAX_ACTIVE_CARDS_PER_USER);
      if (error.message === 'Ja existe um cartao com este nome.') return CARD_WRITE_REPLIES.createNameTaken;
    }
    return CARD_WRITE_REPLIES.createRejected;
  }
  if (kind === 'CARD_RENAME') {
    // 9b-3: recusa do CreditCardsService vira texto claro; nada foi gravado (4xx).
    if (error instanceof HttpException) {
      if (error.getStatus() === 404) return CARD_WRITE_REPLIES.cardGone;
      if (error.message === 'Ja existe um cartao com este nome.') return CARD_WRITE_REPLIES.nameTaken;
      if (error.message === 'Cartao arquivado nao pode ser alterado.') return CARD_WRITE_REPLIES.cardArchived;
    }
    return CARD_WRITE_REPLIES.renameRejected;
  }
  if (kind === 'CREDIT_LIMIT') {
    return REPLIES.creditLimitRejected;
  }
  if (kind === 'RECURRING') {
    return REPLIES.recurringRejected;
  }
  if (kind === 'INSTALLMENT') {
    return REPLIES.installmentRejected;
  }
  // 9b-1: cartao recusado na confirmacao (arquivado, removido ou de outra conta) vira recusa clara; nada foi gravado.
  if (kind === 'TRANSACTION' && error instanceof HttpException && [CARD_NOT_FOUND_MESSAGE, CARD_ARCHIVED_MESSAGE, CARD_NEEDS_CREDIT_MESSAGE].includes(error.message)) {
    return error.message;
  }
  return kind === 'TRANSACTION' ? REPLIES.transactionRejected : REPLIES.goalGone;
}

/** Texto do rascunho mantido após falha inesperada, por tipo. */
function saveFailedText(kind: DraftKind, restored: boolean): string {
  if (kind === 'ENVELOPE') {
    return restored ? REPLIES.envelopeSaveFailed : REPLIES.envelopeSaveFailedRestoreLost;
  }
  if (kind === 'CATEGORY_CREATE' || kind === 'CATEGORY_CHANGE') {
    return restored ? CATEGORY_REPLIES.createSaveFailed : CATEGORY_REPLIES.createSaveFailedRestoreLost;
  }
  if (kind === 'CARD_CREATE') {
    return restored ? CARD_WRITE_REPLIES.createSaveFailed : CARD_WRITE_REPLIES.createSaveFailedRestoreLost;
  }
  if (kind === 'CARD_RENAME') {
    return restored ? CARD_WRITE_REPLIES.renameSaveFailed : CARD_WRITE_REPLIES.renameSaveFailedRestoreLost;
  }
  if (kind === 'CREDIT_LIMIT') {
    return restored ? REPLIES.creditLimitSaveFailed : REPLIES.creditLimitSaveFailedRestoreLost;
  }
  if (kind === 'RECURRING') {
    return restored ? REPLIES.recurringSaveFailed : REPLIES.recurringSaveFailedRestoreLost;
  }
  if (kind === 'INSTALLMENT') {
    return restored ? REPLIES.installmentSaveFailed : REPLIES.installmentSaveFailedRestoreLost;
  }
  if (kind === 'GOAL') {
    return restored ? REPLIES.goalSaveFailed : REPLIES.goalSaveFailedRestoreLost;
  }
  if (kind === 'CONTRIBUTION') {
    return restored ? REPLIES.contributionSaveFailed : REPLIES.contributionSaveFailedRestoreLost;
  }
  return restored ? REPLIES.saveFailed : REPLIES.saveFailedRestoreLost;
}

/** Comprimento em code points (acento e emoji contam um cada). */
function codePointLength(text: string): number {
  return Array.from(text.trim()).length;
}

function ttlFor(state: ConversationState): number {
  return state === ConversationState.AWAITING_CONFIRMATION ? TTL_MS.AWAITING_CONFIRMATION : TTL_MS.COLLECTING_FIELDS;
}

/** Cartao escolhido no rascunho (9b-1): sempre com CREDIT, como a tela exige. */
function pickCard(draft: ExpenseOrIncomeDraft, card: ChatCard): void {
  draft.cardId = card.id;
  draft.cardName = card.name;
  draft.paymentMethod = PaymentMethod.CREDIT;
}

/** Resposta da escolha de cartao: numero 1 a 5 da lista, ou nome (sem acento/caixa). Sem casamento = null. */
function pickCardAnswer(options: ChatCard[], value: string): ChatCard | null {
  const normalized = normalize(value);
  if (/^[1-5]$/.test(normalized) && options[Number(normalized) - 1]) return options[Number(normalized) - 1];
  const term = cleanCardTerm(value);
  if (term === '') return null;
  const hits = matchCardsByTerm(options, term);
  return hits.length === 1 ? hits[0] : null;
}

/** "credito" sem nome com mais de um cartao: a pergunta so vem quando o resto do rascunho ja foi respondido. */
function settleCardChoice(draft: ExpenseOrIncomeDraft): void {
  if (draft.pendingField === null && (draft.cardOptions ?? []).length > 0 && !draft.cardId) draft.pendingField = 'card';
}

function splitTokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length > 0);
}

/** Remove "na", "de", "com"... so do comeco da descrição. */
function stripConnectors(tokens: string[]): string[] {
  let start = 0;
  while (start < tokens.length && CONNECTORS.has(normalize(tokens[start]))) {
    start += 1;
  }
  return tokens.slice(start);
}

/** Igualdade sem acento e caixa; se não houver, prefixo. Devolve todas as candidatas. */
function matchCategory(query: string, categories: CategoryRow[]): CategoryRow[] {
  const target = normalize(query);
  if (target.length === 0) {
    return [];
  }
  const exact = categories.filter((category) => normalize(category.name) === target);
  if (exact.length > 0) {
    return exact;
  }
  return categories.filter((category) => normalize(category.name).startsWith(target));
}

function amountErrorText(reason: AmountFailure): string {
  switch (reason) {
    case 'ZERO':
      return REPLIES.amountZero;
    case 'NEGATIVE':
      return REPLIES.amountNegative;
    case 'TOO_LARGE':
      return REPLIES.amountTooLarge;
    case 'AMBIGUOUS':
      return REPLIES.amountAmbiguous;
    default:
      return REPLIES.amountMissing;
  }
}

/** Próximo campo da reserva: nome antes do valor (quando nenhum dos dois veio, pergunta o nome). */
function envelopePending(name: string | null, monthlyCents: number | null): 'name' | 'amount' | null {
  if (name === null) {
    return 'name';
  }
  return monthlyCents === null ? 'amount' : null;
}

/** Mês UTC da provisão ('AAAA-MM-01'), o mesmo do domínio de reservas. */
function monthYmd(date: Date): string {
  return monthStart(date).toISOString().slice(0, 10);
}

/** Erro de "mudou desde a exibição": devolve o rascunho com os dados atuais e o motivo. Null = outro erro. */
function revisedDraft(draft: SessionDraft, error: unknown): { draft: SessionDraft; reason: string } | null {
  const recurring = revisedRecurringDue(draft, error);
  if (recurring) return recurring;
  if (error instanceof EnvelopeMonthChangedError && draft.kind === 'ENVELOPE') {
    return { draft: { ...draft, provisionMonth: error.provisionMonth }, reason: REPLIES.envelopeMonthChanged };
  }
  if (error instanceof CreditLimitChangedError && draft.kind === 'CREDIT_LIMIT') {
    const current = error.current;
    return {
      draft: {
        ...draft,
        cycleStart: current.cycleStart,
        cycleEnd: current.cycleEnd,
        previousCeilingCents: current.previousCeilingCents,
        countAllPayments: current.countAllPayments,
      },
      reason: REPLIES.creditLimitChanged,
    };
  }
  return null;
}

/** Vencimento que ficou no passado entre rascunho e confirmação: o campo volta a ser pedido. */
function revisedRecurringDue(draft: SessionDraft, error: unknown): { draft: SessionDraft; reason: string } | null {
  if (error instanceof RecurringFirstDueChangedError && draft.kind === 'RECURRING') {
    return { draft: { ...draft, firstDueDate: null, pendingField: 'firstDueDate' }, reason: REPLIES.firstDueChanged };
  }
  if (error instanceof InstallmentFirstDueChangedError && draft.kind === 'INSTALLMENT') {
    return { draft: { ...draft, firstDueDate: null, pendingField: 'firstDueDate' }, reason: REPLIES.firstDueChanged };
  }
  return null;
}

/** Linha "Atenção" quando a confirmação foi refeita por mudança de mês ou ciclo. */
function reviewRows(reason: string | undefined): Array<{ label: string; value: string }> {
  return reason ? [{ label: 'Atenção', value: reason }] : [];
}

/** Reais de float (ex.: soma do Prisma) para centavos inteiros, so na fronteira de leitura. */
function toCents(value: number | string | Prisma.Decimal | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100);
}

/** Campos da constraint violada (meta.target do Prisma). Sem meta, assume-se `appliedKey` (lado seguro). */
function violatedField(error: unknown, field: string): boolean {
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) {
    return target.includes(field);
  }
  if (typeof target === 'string') {
    return target.includes(field);
  }
  return true;
}

/** Item de vencimento já com valor em centavos (consulta upcoming_dues). */
interface DueItem {
  date: string;
  label: string;
  kind: 'FIXED' | 'INSTALLMENT';
  tag: string;
  amountCents: number;
}

/** Data-só do serviço (meia-noite UTC) como 'AAAA-MM-DD'. */
function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateOrNull(date: Date | null): string | null {
  return date ? toYmd(date) : null;
}

function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ordem crescente com nulos por último. */
function compareYmdNullable(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    return a === null && b === null ? 0 : a === null ? 1 : -1;
  }
  return compareYmd(a, b);
}

/**
 * Valor mensal de uma conta fixa em doze avos de centavo (contrato 3): mensal x 12, anual x 1, semanal x 52.
 * Dividir a soma por 12 dá o mensal em centavos: semanal x 52 / 12, anual / 12.
 */
function monthlyTwelfths(row: RecurringRow): number {
  const cents = toCents(row.amount);
  switch (row.frequency) {
    case 'WEEKLY':
      return cents * WEEKS_PER_YEAR;
    case 'YEARLY':
      return cents;
    default:
      return cents * MONTHS_PER_YEAR;
  }
}

/**
 * Valor da parcela em centavos. A última parcela absorve a sobra do arredondamento
 * (installment-materializer): nesse caso o valor certo é o restante, não installmentAmount.
 */
function installmentCents(row: InstallmentRow): number {
  return toCents(row.remainingInstallments === 1 ? row.remainingAmount : row.installmentAmount);
}

/** Corta em 60 caracteres (contando code points); o último vira "…". */
function truncate(text: string): string {
  const chars = Array.from(text.trim());
  return chars.length > LINE_MAX_CHARS ? `${chars.slice(0, LINE_MAX_CHARS - 1).join('')}…` : chars.join('');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
