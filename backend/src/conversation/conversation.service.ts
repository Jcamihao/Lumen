import { Injectable } from '@nestjs/common';
import {
  ConversationChannel,
  ConversationOutcome,
  ConversationState,
  Prisma,
  TransactionType,
} from '@prisma/client';
import { CreditCycleService } from '../credit-cycle/credit-cycle.service';
import { localToday } from '../recurring-transactions/recurrence.util';
import { DashboardService } from '../dashboard/dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { parseAmountPrefix, AmountFailure } from './parsers/amount.parser';
import { extractDate } from './parsers/date.parser';
import { normalize } from './parsers/normalize';
import { IntentMatch, ReadIntent, matchIntent } from './parsers/intent.matcher';
import {
  REPLIES,
  balanceText,
  cardText,
  categoryOptionsText,
  categoryTotalText,
  doneText,
  draftText,
  formatBrl,
  monthSummaryText,
  spendTotalText,
} from './replies';
import {
  ConversationInput,
  ConversationReply,
  ConversationReplyKind,
  ConversationStateView,
  DraftView,
  ExpenseOrIncomeDraft,
  ReplyData,
} from './conversation.types';

/** Prazos do contrato (secao 5): coleta 15 min, confirmacao 5 min. */
const TTL_MS: Record<'COLLECTING_FIELDS' | 'AWAITING_CONFIRMATION', number> = {
  COLLECTING_FIELDS: 15 * 60_000,
  AWAITING_CONFIRMATION: 5 * 60_000,
};

const CANCEL_WORDS = new Set(['cancelar', 'parar', 'voltar']);
const CONFIRM_WORDS = new Set(['confirmar', 'sim', 'ok']);
const CONNECTORS = new Set(['na', 'no', 'em', 'de', 'do', 'da', 'com', 'pra', 'para']);
const MAX_CATEGORY_OPTIONS = 5;
const DESCRIPTION_MIN = 2;
const DESCRIPTION_MAX = 120;
const READ_INTENTS: ReadIntent[] = ['balance', 'month_summary', 'spend_total', 'credit_card'];

type CategoryRow = { id: string; name: string };

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
    private readonly creditCycle: CreditCycleService,
    private readonly transactions: TransactionsService,
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

  /** Botao "Confirmar". Null = 404 no controller (inexistente, outra conta, versao antiga ou já consumido). */
  async confirmDraft(userId: string, draftId: string, draftVersion: number): Promise<ConversationReply | null> {
    const session = await this.prisma.conversationSession.findFirst({
      where: { id: draftId, userId, state: ConversationState.AWAITING_CONFIRMATION },
    });
    if (!session || session.version !== draftVersion) {
      return null;
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

  /** Estado do canal APP para o app reabrir a conversa. Sem sessao ativa = IDLE. */
  async getSession(userId: string): Promise<{ state: ConversationStateView; draft?: DraftView }> {
    const session = await this.loadSession(userId, ConversationChannel.APP);
    if (!session || session.expiresAt < new Date()) {
      return { state: 'IDLE' };
    }
    const draft = await this.toDraftView(session);
    return { state: session.state, draft };
  }

  // ---------- sem sessao ativa ----------

  private async handleWithoutSession(args: { input: ConversationInput; text: string }): Promise<ConversationReply> {
    const { input, text } = args;
    const intent = text.length > 0 ? matchIntent(text) : null;

    if (!intent) {
      await this.recordEvent(input, null, ConversationOutcome.UNRECOGNIZED);
      const word = normalize(text);
      const control = CONFIRM_WORDS.has(word) || CANCEL_WORDS.has(word);
      const help = this.reply('HELP', 'IDLE', REPLIES.unrecognized);
      return control ? help : { ...help, unrecognized: true };
    }
    if (intent.intent === 'create_expense' || intent.intent === 'create_income') {
      return this.startDraft({ input, intent });
    }
    if (intent.intent === 'help') {
      await this.recordEvent(input, 'help', ConversationOutcome.RECOGNIZED);
      return this.reply('HELP', 'IDLE', REPLIES.help);
    }
    const read = await this.answerRead({ userId: input.userId, intent });
    await this.recordEvent(input, intent.intent, ConversationOutcome.RECOGNIZED);
    return { ...read, state: 'IDLE' };
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

    const amount = parseAmountPrefix(intent.body);
    if (amount.ok === false) {
      await this.recordEvent(input, intent.intent, ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', amountErrorText(amount.reason));
    }

    const dateResult = extractDate(splitTokens(amount.rest), today);
    if (dateResult.invalid) {
      await this.recordEvent(input, intent.intent, ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', REPLIES.invalidDate);
    }

    const description = stripConnectors(dateResult.rest).join(' ');
    if (description.length > DESCRIPTION_MAX) {
      await this.recordEvent(input, intent.intent, ConversationOutcome.ERROR);
      return this.reply('ERROR', 'IDLE', REPLIES.descriptionTooLong);
    }

    const draft: ExpenseOrIncomeDraft = {
      type,
      amountCents: amount.cents,
      description: description.length >= DESCRIPTION_MIN ? description : null,
      categoryId: null,
      date: dateResult.ymd,
      paymentMethod: null,
      pendingField: null,
      categoryOptions: [],
    };

    if (draft.description === null) {
      draft.pendingField = 'description';
    } else {
      await this.resolveCategory(userId, draft, description);
    }

    return this.saveNewDraft({ input, intent: intent.intent, draft, today });
  }

  private async saveNewDraft(args: {
    input: ConversationInput;
    intent: string;
    draft: ExpenseOrIncomeDraft;
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
    const intent = text.length > 0 ? matchIntent(text) : null;
    const awaiting = session.state === ConversationState.AWAITING_CONFIRMATION;

    if (CANCEL_WORDS.has(words)) {
      return this.cancelSession(userId, session, input.messageId);
    }
    if (CONFIRM_WORDS.has(words)) {
      if (awaiting) {
        return this.applyDraft({ userId, session, messageId: input.messageId, now: input.receivedAt, channel: input.channel });
      }
      // "ok" fora de AWAITING_CONFIRMATION não faz nada (contrato secao 6).
      await this.recordEvent(input, session.intent, ConversationOutcome.UNRECOGNIZED);
      return this.draftReply(session, await this.todayYmd(userId, input.receivedAt), { prefix: REPLIES.collectingReminder });
    }
    if (!awaiting && isOptionNumber(words, session.draft as unknown as ExpenseOrIncomeDraft)) {
      // "1".."5" respondem a pergunta de categoria; sem isso o matcher leria como gasto de R$ 1.
      return this.fillPendingField({ input, session, text });
    }
    if (intent && isReadIntent(intent)) {
      const read = await this.answerRead({ userId, intent });
      await this.recordEvent(input, intent.intent, ConversationOutcome.RECOGNIZED);
      return { ...read, state: this.stateView(session) };
    }
    if (intent && intent.intent === 'help') {
      await this.recordEvent(input, 'help', ConversationOutcome.RECOGNIZED);
      return this.reply('HELP', this.stateView(session), REPLIES.help);
    }
    if (awaiting) {
      await this.recordEvent(input, session.intent, ConversationOutcome.UNRECOGNIZED);
      return this.draftReply(session, await this.todayYmd(userId, input.receivedAt), { prefix: REPLIES.confirmReminder });
    }
    if (intent) {
      // Comando de escrita com rascunho em coleta: não substitui o rascunho em silencio.
      await this.recordEvent(input, session.intent, ConversationOutcome.UNRECOGNIZED);
      return this.draftReply(session, await this.todayYmd(userId, input.receivedAt), { prefix: REPLIES.collectingReminder });
    }
    return this.fillPendingField({ input, session, text });
  }

  /** Preenche o campo que falta (descrição ou categoria). */
  private async fillPendingField(args: {
    input: ConversationInput;
    session: SessionRow;
    text: string;
  }): Promise<ConversationReply> {
    const { input, session, text } = args;
    const { userId, receivedAt } = input;
    const draft = session.draft as unknown as ExpenseOrIncomeDraft;
    const today = await this.todayYmd(userId, receivedAt);
    const value = text.trim();

    if (draft.pendingField === 'description') {
      if (value.length < DESCRIPTION_MIN) {
        await this.recordEvent(input, session.intent, ConversationOutcome.UNRECOGNIZED);
        return this.draftReply(session, today, { question: REPLIES.askDescription });
      }
      if (value.length > DESCRIPTION_MAX) {
        await this.recordEvent(input, session.intent, ConversationOutcome.ERROR);
        return this.reply('ERROR', this.stateView(session), REPLIES.descriptionTooLong);
      }
      draft.description = value;
      draft.pendingField = null;
      await this.resolveCategory(userId, draft, value);
    } else if (draft.pendingField === 'category') {
      draft.categoryId = await this.pickCategoryAnswer(userId, draft, value);
      draft.categoryOptions = [];
      draft.pendingField = null;
    }

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
    const draft = session.draft as unknown as ExpenseOrIncomeDraft;

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

    let transactionId: string;
    try {
      const created = await this.transactions.create(userId, {
        type: draft.type,
        description: draft.description,
        amount: draft.amountCents / 100,
        // Meia-noite UTC, igual à tela de Finanças (new Date('YYYY-MM-DD')). O ciclo do cartão
        // usa `lte` na meia-noite UTC do dia de fechamento: meio-dia deixaria a compra desse dia fora do ciclo.
        date: `${draft.date}T00:00:00.000Z`,
        categoryId: draft.categoryId ?? undefined,
        paymentMethod: draft.paymentMethod ?? undefined,
      });
      transactionId = created.id;
    } catch {
      // Falha ao gravar: devolve o rascunho, sem lançamento e sem chave aplicada.
      await this.prisma.conversationEvent.updateMany({
        where: { id: event.id, userId },
        data: { outcome: ConversationOutcome.ERROR, appliedKey: null },
      });
      const restored = await this.restoreSession({ userId, session, channel, now });
      return this.reply(
        'ERROR',
        restored ? ConversationState.AWAITING_CONFIRMATION : 'IDLE',
        restored ? REPLIES.saveFailed : REPLIES.saveFailedRestoreLost,
      );
    }

    // O lançamento já existe: falha só da métrica não pode virar erro 500 (o usuário refaria e duplicaria).
    await this.prisma.conversationEvent
      .updateMany({
        where: { id: event.id, userId },
        data: { outcome: ConversationOutcome.COMPLETED, resultRef: transactionId },
      })
      .catch(() => undefined);
    return {
      kind: 'DONE',
      state: 'IDLE',
      text: doneText(draft.type, draft.amountCents, draft.description ?? ''),
      data: { transactionId },
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
          state: ConversationState.AWAITING_CONFIRMATION,
          intent: session.intent,
          draft: session.draft as Prisma.InputJsonValue,
          version: session.version,
          expiresAt: new Date(now.getTime() + TTL_MS.AWAITING_CONFIRMATION),
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

  private async answerRead(args: { userId: string; intent: IntentMatch }): Promise<ConversationReply> {
    const { userId, intent } = args;
    switch (intent.intent) {
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
      case 'credit_card': {
        const cycle = await this.creditCycle.getCurrent(userId);
        const card = {
          ceilingCents: cycle.ceiling === null ? null : toCents(cycle.ceiling),
          spentCents: toCents(cycle.spent),
          remainingCents: cycle.remaining === null ? null : toCents(cycle.remaining),
          percentUsed: cycle.percentUsed,
          closingDay: cycle.closingDay,
          dueDay: cycle.dueDay,
        };
        return this.infoReply(cardText(card), { card });
      }
      case 'help':
        return this.reply('HELP', 'IDLE', REPLIES.help);
      default:
        return this.reply('ERROR', 'IDLE', REPLIES.unrecognized);
    }
  }

  private async spendByCategory(userId: string, query: string): Promise<ConversationReply> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [grouped, categories] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, type: TransactionType.EXPENSE, date: { gte: monthStart, lte: now } },
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

  /** Mesmos numeros da tela inicial: DashboardService.getSummary, sem reescrever a formula. */
  private async readFinances(userId: string): Promise<DashboardFinances> {
    return (await this.dashboard.getSummary(userId)) as DashboardFinances;
  }

  private infoReply(text: string, data: ReplyData): ConversationReply {
    return { kind: 'INFO', state: 'IDLE', text, data };
  }

  // ---------- categorias e rascunho ----------

  /** Escolhe categoria pela descrição: unica = define; varias ou nenhuma = pergunta. */
  private async resolveCategory(userId: string, draft: ExpenseOrIncomeDraft, query: string): Promise<void> {
    const categories = await this.prisma.financeCategory.findMany({
      where: { userId, type: draft.type },
      select: { id: true, name: true },
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
    draft.categoryOptions = matched.slice(0, MAX_CATEGORY_OPTIONS).map((category) => category.id);
  }

  /** Resposta da pergunta de categoria. Não casou = sem categoria (não fica em loop). */
  private async pickCategoryAnswer(userId: string, draft: ExpenseOrIncomeDraft, answer: string): Promise<string | null> {
    const normalized = normalize(answer);
    if (normalized === 'sem categoria') {
      return null;
    }
    if (/^[1-5]$/.test(normalized) && draft.categoryOptions[Number(normalized) - 1]) {
      return draft.categoryOptions[Number(normalized) - 1];
    }
    const categories = await this.prisma.financeCategory.findMany({
      where: { userId, type: draft.type },
      select: { id: true, name: true },
    });
    const pool = draft.categoryOptions.length > 0
      ? categories.filter((category) => draft.categoryOptions.includes(category.id))
      : categories;
    const matched = matchCategory(answer, pool);
    return matched.length === 1 ? matched[0].id : null;
  }

  /** Resposta com o rascunho atual. prefix vai antes do texto; question troca a pergunta de campo. */
  private async draftReply(
    session: SessionRow,
    today: string,
    options: { prefix?: string; question?: string } = {},
  ): Promise<ConversationReply> {
    const draft = session.draft as unknown as ExpenseOrIncomeDraft;
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
    const body = draftText({
      type: draft.type,
      amountCents: draft.amountCents,
      description: draft.description ?? '',
      category: view.category,
      date: draft.date,
      paymentMethod: draft.paymentMethod,
      futureDate: draft.date > today,
    });
    return {
      kind: 'CONFIRM_DRAFT',
      state: ConversationState.AWAITING_CONFIRMATION,
      text: [options.prefix, body].filter(Boolean).join('\n'),
      draft: view,
      quickReplies: ['confirmar', 'cancelar'],
    };
  }

  private async questionFor(userId: string, draft: ExpenseOrIncomeDraft): Promise<string> {
    if (draft.pendingField === 'description') {
      return REPLIES.askDescription;
    }
    if (draft.categoryOptions.length === 0) {
      return REPLIES.askCategoryNoOptions;
    }
    const names = await this.categoryNames(userId, draft.categoryOptions);
    return categoryOptionsText(names);
  }

  private async toDraftView(session: SessionRow): Promise<DraftView> {
    const draft = session.draft as unknown as ExpenseOrIncomeDraft;
    const category = draft.categoryId
      ? (await this.prisma.financeCategory.findFirst({
          where: { id: draft.categoryId, userId: session.userId },
          select: { name: true },
        }))?.name ?? null
      : null;
    return {
      draftId: session.id,
      draftVersion: session.version,
      type: draft.type,
      amount: formatBrl(draft.amountCents),
      description: draft.description,
      category,
      date: draft.date,
      paymentMethod: draft.paymentMethod,
      pendingField: draft.pendingField,
    };
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

// ---------- funcoes puras do motor ----------

function isReadIntent(match: IntentMatch): match is { intent: ReadIntent } | { intent: 'spend_by_category'; categoryQuery: string } {
  return match.intent === 'spend_by_category' || (READ_INTENTS as string[]).includes(match.intent);
}

/** Resposta numérica válida à pergunta de categoria (opção existente no rascunho). */
function isOptionNumber(words: string, draft: ExpenseOrIncomeDraft): boolean {
  return (
    draft.pendingField === 'category' &&
    /^[1-5]$/.test(words) &&
    draft.categoryOptions[Number(words) - 1] !== undefined
  );
}

function ttlFor(state: ConversationState): number {
  return state === ConversationState.AWAITING_CONFIRMATION ? TTL_MS.AWAITING_CONFIRMATION : TTL_MS.COLLECTING_FIELDS;
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
