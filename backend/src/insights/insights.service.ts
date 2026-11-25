import { Injectable } from '@nestjs/common';
import { InsightSeverity, InsightType, Prisma, ReceiptScanStatus } from '@prisma/client';
import {
  differenceInCalendarDays,
  differenceInDays,
  endOfDay,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { cardSpendWhere, creditCycleBounds } from '../credit-cycle/credit-cycle.util';
import { addDaysUtc, localToday } from '../recurring-transactions/recurrence.util';

type GeneratedInsight = {
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

type InsightContext = Awaited<ReturnType<InsightsService['loadContext']>>;

type ChargeOccurrence = {
  id: string;
  description: string;
  amount: number;
  date: Date;
};

type ReceiptItemSnapshot = {
  description: string;
  totalPrice: number;
};

type ReceiptScanSnapshot = {
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

/**
 * Janela de leitura das despesas usada pelos detectores de cobranca.
 * 120 dias cobrem 4 ciclos mensais, o minimo para enxergar uma assinatura
 * com tres ocorrencias e ainda sobrar folga.
 */
const CHARGE_WINDOW_DAYS = 120;
const CHARGE_WINDOW_MAX_ROWS = 500;

/** Cobrancas iguais dentro dessa janela sao tratadas como possivel duplicata. */
const DUPLICATE_WINDOW_DAYS = 3;

/** Intervalo aceito entre ocorrencias para considerar a cobranca mensal. */
const MONTHLY_GAP_MIN_DAYS = 25;
const MONTHLY_GAP_MAX_DAYS = 35;
const MIN_OCCURRENCES_FOR_SUBSCRIPTION = 3;

/** Quantas notas fiscais importadas olhar pra tras ao procurar pares pra comparar. */
const RECEIPT_SCAN_MAX_ROWS = 200;

// Mudanca de peso de uma categoria nos gastos do mes vs. mes anterior. Compara
// a PARTICIPACAO (% do total gasto), nao o valor: o mes corrente esta pela
// metade e valor absoluto sempre pareceria "queda".
const CATEGORY_SHIFT_MIN_TOTAL = 200;
const CATEGORY_SHIFT_MIN_TRANSACTIONS = 5;
const CATEGORY_SHIFT_MIN_SHARE_PCT = 20;
const CATEGORY_SHIFT_MIN_DELTA_PTS = 10;
const CATEGORY_SHIFT_WARNING_DELTA_PTS = 20;

// Orcamento mensal por categoria: avisa ao chegar perto do teto e de novo ao
// estourar. Limitado aos maiores consumos para nao inundar o painel.
const BUDGET_NEAR_PCT = 80;
const BUDGET_OVER_PCT = 100;
const BUDGET_MAX_ALERTS = 3;

// Conta fixa que vence nos proximos dias: avisa com antecedencia (amanha vira
// WARNING). No dia do vencimento o lancamento ja foi gerado e o aviso some.
const UPCOMING_BILL_WINDOW_DAYS = 3;
const UPCOMING_BILL_MAX_LISTED = 3;

// Mesmos limiares do orcamento por categoria e do CreditCycleService: 80%
// avisa, 100% estourou. Duplicado de proposito (mesmo padrao do resto do
// arquivo) — se um mudar, o outro precisa acompanhar.
const CREDIT_CYCLE_NEAR_PCT = 80;
const CREDIT_CYCLE_OVER_PCT = 100;

type CategoryTotal = {
  categoryId: string | null;
  name: string;
  total: number;
  count: number;
};

/** Alta o suficiente pra virar aviso, ou critica, de aumento de gasto no mesmo estabelecimento. */
const RECEIPT_TOTAL_WARNING_PCT = 0.15;
const RECEIPT_TOTAL_CRITICAL_PCT = 0.4;

/**
 * Cada tipo de insight fala por uma persona propria, para que a leitura tenha
 * voz e nao seja um bloco unico de texto. Trocar um nome aqui muda a voz em
 * todo lugar que consome o insight (dashboard e Selah).
 */
const INSIGHT_PERSONAS: Record<InsightType, { name: string; role: string }> = {
  [InsightType.PRODUCTIVITY]: {
    name: 'Norte',
    role: 'aponta o que destrava o seu dia',
  },
  [InsightType.FINANCE]: {
    name: 'Lastro',
    role: 'cuida do que sustenta o seu mes',
  },
  [InsightType.GOAL]: {
    name: 'Horizonte',
    role: 'acompanha o que voce quer alcancar',
  },
  [InsightType.ROUTINE]: {
    name: 'Compasso',
    role: 'observa o ritmo da sua rotina',
  },
};

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const existingInsights = await this.prisma.insight.findMany({
      where: { userId },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    });

    if (existingInsights.length > 0) {
      return existingInsights;
    }

    return this.refreshForUser(userId);
  }

  /**
   * Reconcilia os insights do usuario com a situacao atual.
   *
   * Faz upsert por fingerprint em vez de apagar e recriar tudo: enquanto a
   * situacao persistir, a linha sobrevive e com ela o notifiedAt — que e o
   * que impede o worker de notificar o mesmo alerta a cada ciclo da fila.
   * Fingerprints que sumiram da geracao sao podados, entao uma situacao que
   * se resolve e volta depois e tratada como nova (e avisa de novo).
   */
  async refreshForUser(userId: string) {
    const generatedInsights = await this.generateInsights(userId);
    const fingerprints = generatedInsights.map((insight) =>
      this.fingerprintOf(insight),
    );

    await this.prisma.$transaction([
      this.prisma.insight.deleteMany({
        where: { userId, fingerprint: { notIn: fingerprints } },
      }),
      ...generatedInsights.map((insight) => {
        const fingerprint = this.fingerprintOf(insight);
        const content = {
          type: insight.type,
          severity: insight.severity,
          message: insight.message,
          metadata: insight.metadata as Prisma.InputJsonValue | undefined,
        };

        return this.prisma.insight.upsert({
          where: { userId_fingerprint: { userId, fingerprint } },
          create: { userId, fingerprint, ...content },
          update: content,
        });
      }),
    ]);

    return this.prisma.insight.findMany({
      where: { userId },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    });
  }

  /**
   * Devolve os insights que ainda merecem notificacao e ja os marca como
   * avisados, para que uma segunda passada da fila nao repita o alerta.
   */
  async takePendingNotifications(
    userId: string,
    severities: InsightSeverity[] = [InsightSeverity.CRITICAL],
  ) {
    const pending = await this.prisma.insight.findMany({
      where: {
        userId,
        notifiedAt: null,
        severity: { in: severities },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (pending.length === 0) {
      return [];
    }

    await this.prisma.insight.updateMany({
      where: { id: { in: pending.map((insight) => insight.id) } },
      data: { notifiedAt: new Date() },
    });

    return pending;
  }

  private async generateInsights(userId: string): Promise<GeneratedInsight[]> {
    const context = await this.loadContext(userId);

    const insights = [
      this.detectOverdueTasks(context),
      this.detectExpenseRatio(context),
      this.detectStalledGoals(context),
      this.detectBusyDay(context),
      this.detectRemindersToday(context),
      this.detectOverdueFinancialCost(context),
      this.detectGoalsBlockedByTasks(context),
      this.detectDuplicateCharges(context),
      this.detectRecurringCharges(context),
      this.detectReceiptComparison(context),
      this.detectUpcomingBirthday(context),
      this.detectPrimaryGoalWithoutTracking(context),
      this.detectCategoryShift(context),
    ].filter((insight): insight is GeneratedInsight => insight !== null);

    insights.push(...this.detectCategoryBudgets(context));
    const creditCycleInsight = this.detectCreditCycle(context);
    if (creditCycleInsight) insights.push(creditCycleInsight);
    const upcomingBills = this.detectUpcomingBills(context);
    if (upcomingBills) insights.push(upcomingBills);

    if (insights.length === 0) {
      insights.push({
        type: InsightType.ROUTINE,
        key: 'calm',
        severity: InsightSeverity.INFO,
        message: 'Seu momento parece equilibrado: sem alertas relevantes agora, com espaco para focar no que acelera seus objetivos.',
      });
    }

    return insights.map((insight) => this.withPersona(insight));
  }

  /** Carimba a persona do tipo no metadata, sem exigir nada de cada detector. */
  private withPersona(insight: GeneratedInsight): GeneratedInsight {
    return {
      ...insight,
      metadata: {
        ...(insight.metadata ?? {}),
        persona: INSIGHT_PERSONAS[insight.type],
      },
    };
  }

  /**
   * Identidade estavel da situacao: tipo, regra e severidade.
   * A severidade entra de proposito — quando um alerta escala de WARNING para
   * CRITICAL a situacao mudou de fato e merece ser avisada de novo.
   */
  private fingerprintOf(insight: GeneratedInsight) {
    return `${insight.type}:${insight.key}:${insight.severity}`;
  }

  /** Resumo curto e estavel de um assunto, para compor a chave da regra. */
  private hashSubject(parts: string[]) {
    return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
  }

  private async loadContext(userId: string) {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = startOfMonth(now);
    // Limites UTC (datas de transacao sao gravadas a meia-noite UTC).
    const currentMonthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const previousMonthEnd = new Date(currentMonthStartUtc.getTime() - 1);

    const [
      user,
      overdueTasks,
      tasksToday,
      monthlyExpensesAggregate,
      goals,
      remindersToday,
      recentExpenses,
      recentReceiptScans,
      currentCategoryGroups,
      previousCategoryGroups,
      financeCategories,
      recurringExpenseTemplates,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
      }),
      this.prisma.task.findMany({
        where: {
          userId,
          status: {
            in: ['PENDING', 'IN_PROGRESS'],
          },
          dueDate: {
            lt: todayStart,
          },
        },
      }),
      this.prisma.task.findMany({
        where: {
          userId,
          dueDate: {
            gte: todayStart,
            lte: todayEnd,
          },
          status: {
            in: ['PENDING', 'IN_PROGRESS'],
          },
        },
      }),
      this.prisma.transaction.aggregate({
        where: {
          userId,
          type: 'EXPENSE',
          date: {
            gte: monthStart,
            lte: now,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.goal.findMany({
        where: {
          userId,
          status: {
            in: ['ACTIVE', 'PLANNED'],
          },
        },
      }),
      this.prisma.reminder.findMany({
        where: {
          userId,
          remindAt: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
      }),
      this.prisma.transaction.findMany({
        where: {
          userId,
          type: 'EXPENSE',
          // Lancamento gerado por conta fixa ja e conhecido pelo usuario: nao
          // deve virar "identifiquei uma cobranca recorrente".
          recurringTransactionId: null,
          date: {
            gte: subDays(todayStart, CHARGE_WINDOW_DAYS),
            lte: todayEnd,
          },
        },
        select: {
          id: true,
          description: true,
          amount: true,
          date: true,
        },
        orderBy: { date: 'desc' },
        take: CHARGE_WINDOW_MAX_ROWS,
      }),
      this.prisma.receiptScan.findMany({
        where: {
          userId,
          status: ReceiptScanStatus.IMPORTED,
          // So participa da comparacao quem tem grupo — e o grupo, nao mais o
          // nome do estabelecimento, que define o que e comparavel com o que.
          tagGroupId: { not: null },
        },
        select: {
          id: true,
          merchantName: true,
          purchaseDate: true,
          totalAmount: true,
          tagGroupId: true,
          compareWithPrevious: true,
          tagGroup: {
            select: { name: true },
          },
          items: {
            select: {
              description: true,
              totalPrice: true,
            },
          },
        },
        orderBy: { purchaseDate: 'desc' },
        take: RECEIPT_SCAN_MAX_ROWS,
      }),
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: {
          userId,
          type: 'EXPENSE',
          date: { gte: currentMonthStartUtc, lte: now },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: {
          userId,
          type: 'EXPENSE',
          date: { gte: previousMonthStart, lte: previousMonthEnd },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.financeCategory.findMany({
        where: { userId },
        select: { id: true, name: true, monthlyBudget: true },
      }),
      // Janela larga em UTC; o corte exato usa o "hoje" do fuso do usuario abaixo.
      this.prisma.recurringTransaction.findMany({
        where: {
          userId,
          isActive: true,
          type: 'EXPENSE',
          nextDueDate: {
            gte: addDaysUtc(now, -2),
            lte: addDaysUtc(now, UPCOMING_BILL_WINDOW_DAYS + 2),
          },
        },
        select: { id: true, description: true, amount: true, nextDueDate: true },
        orderBy: { nextDueDate: 'asc' },
      }),
    ]);

    const userToday = localToday(now, user.timezone ?? 'UTC');
    // 9c-2: o ciclo de credito e do cartao padrao (contrato item 9, secao 4.8); sem
    // cartao (estado corrompido), cai no fechamento 30 e vencimento null.
    const defaultCard = await this.prisma.creditCard.findFirst({
      where: { userId, isDefault: true, archivedAt: null },
      select: { id: true, isDefault: true, countAllPayments: true, closingDay: true, dueDay: true },
    });
    // Ciclo do cartao padrao (contrato 4.8).
    const creditCycle = creditCycleBounds(userToday, defaultCard?.closingDay ?? 30);
    const [creditCeilingRow, creditSpentAggregate] = await Promise.all([
      defaultCard
        ? this.prisma.creditCycleCeiling.findUnique({
            where: { cardId_closingDate: { cardId: defaultCard.id, closingDate: creditCycle.end } },
          })
        : Promise.resolve(null),
      // Mesma regra do ciclo do cartao (cardSpendWhere). Sem cartao padrao ativo: gasto zero.
      defaultCard
        ? this.prisma.transaction.aggregate({
            where: cardSpendWhere({ userId }, defaultCard, creditCycle.start, creditCycle.end),
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
    ]);
    const windowEnd = addDaysUtc(userToday, UPCOMING_BILL_WINDOW_DAYS);
    const upcomingBills = (recurringExpenseTemplates ?? [])
      .map((bill) => ({
        id: bill.id,
        description: bill.description,
        amount: Number(bill.amount),
        dueDate: new Date(bill.nextDueDate),
      }))
      .filter((bill) => bill.dueDate > userToday && bill.dueDate <= windowEnd)
      .map((bill) => ({
        ...bill,
        daysUntil: Math.round((bill.dueDate.getTime() - userToday.getTime()) / 86_400_000),
      }));

    const categoryNames = new Map(
      (financeCategories ?? []).map((category) => [category.id, category.name]),
    );
    const toCategoryTotals = (groups: any[] | undefined): CategoryTotal[] =>
      (groups ?? []).map((group) => ({
        categoryId: group.categoryId ?? null,
        name: group.categoryId
          ? (categoryNames.get(group.categoryId) ?? 'Categoria removida')
          : 'Sem categoria',
        total: Number(group._sum?.amount ?? 0),
        count: Number(group._count?._all ?? 0),
      }));

    return {
      now,
      user,
      overdueTasks,
      tasksToday,
      goals,
      remindersToday,
      monthlyExpenses: Number(monthlyExpensesAggregate._sum.amount ?? 0),
      monthlyIncome: Number(user.monthlyIncome ?? 0),
      upcomingBills,
      creditCycle: {
        closingDate: creditCycle.end,
        dueDay: defaultCard?.dueDay ?? null,
        ceiling: creditCeilingRow ? Number(creditCeilingRow.ceiling) : null,
        spent: Number(creditSpentAggregate._sum.amount ?? 0),
      },
      categoryBudgets: (financeCategories ?? [])
        .filter((category) => category.monthlyBudget !== null && category.monthlyBudget !== undefined)
        .map((category) => ({
          categoryId: category.id,
          name: category.name,
          budget: Number(category.monthlyBudget),
        }))
        .filter((category) => category.budget > 0),
      categorySpending: {
        current: toCategoryTotals(currentCategoryGroups),
        previous: toCategoryTotals(previousCategoryGroups),
        previousMonthLabel: new Intl.DateTimeFormat('pt-BR', {
          month: 'long',
          timeZone: 'UTC',
        }).format(previousMonthStart),
      },
      recentExpenses: (recentExpenses ?? []).map((expense) => ({
        id: expense.id,
        description: expense.description,
        amount: Number(expense.amount),
        date: new Date(expense.date),
      })) as ChargeOccurrence[],
      recentReceiptScans: (recentReceiptScans ?? [])
        .filter((scan) => !!scan.tagGroupId)
        .map((scan) => ({
          id: scan.id,
          merchantName: (scan.merchantName ?? '').trim(),
          purchaseDate: new Date(scan.purchaseDate ?? new Date()),
          totalAmount: Number(scan.totalAmount),
          tagGroupId: scan.tagGroupId as string,
          tagGroupName: scan.tagGroup?.name ?? 'Grupo removido',
          compareWithPrevious: scan.compareWithPrevious,
          items: scan.items.map((item) => ({
            description: item.description,
            totalPrice: Number(item.totalPrice),
          })),
        })) as ReceiptScanSnapshot[],
    };
  }

  /**
   * Categoria que ganhou muito peso nos gastos do mes em relacao ao mes
   * anterior. Compara participacao (%), exige volume minimo nos dois meses e
   * ignora gasto sem categoria (nao ha o que apontar). Escolhe so a maior alta.
   */
  private detectCategoryShift(context: InsightContext): GeneratedInsight | null {
    const { current, previous, previousMonthLabel } = context.categorySpending;
    const sum = (rows: CategoryTotal[], field: 'total' | 'count') =>
      rows.reduce((acc, row) => acc + row[field], 0);
    const currentTotal = sum(current, 'total');
    const previousTotal = sum(previous, 'total');

    if (
      currentTotal < CATEGORY_SHIFT_MIN_TOTAL ||
      previousTotal < CATEGORY_SHIFT_MIN_TOTAL ||
      sum(current, 'count') < CATEGORY_SHIFT_MIN_TRANSACTIONS
    ) {
      return null;
    }

    const previousShareById = new Map(
      previous.map((row) => [row.categoryId, (row.total / previousTotal) * 100]),
    );
    let best: { row: CategoryTotal; share: number; previousShare: number; delta: number } | null =
      null;

    for (const row of current) {
      if (!row.categoryId) continue;

      const share = (row.total / currentTotal) * 100;
      const previousShare = previousShareById.get(row.categoryId) ?? 0;
      const delta = share - previousShare;

      if (
        share >= CATEGORY_SHIFT_MIN_SHARE_PCT &&
        delta >= CATEGORY_SHIFT_MIN_DELTA_PTS &&
        (!best || delta > best.delta)
      ) {
        best = { row, share, previousShare, delta };
      }
    }

    if (!best) {
      return null;
    }

    const shareLabel = Math.round(best.share);
    const previousShareLabel = Math.round(best.previousShare);
    const monthTag = `${context.now.getUTCFullYear()}-${context.now.getUTCMonth() + 1}`;

    return {
      type: InsightType.FINANCE,
      key: `category_shift:${this.hashSubject([best.row.categoryId as string, monthTag])}`,
      severity:
        best.delta >= CATEGORY_SHIFT_WARNING_DELTA_PTS
          ? InsightSeverity.WARNING
          : InsightSeverity.INFO,
      message: `${best.row.name} ja pesa ${shareLabel}% dos seus gastos deste mes, contra ${previousShareLabel}% em ${previousMonthLabel} — a maior alta entre as categorias. Vale olhar o que puxou isso.`,
      metadata: {
        category: best.row.name,
        sharePct: shareLabel,
        previousSharePct: previousShareLabel,
        previousMonth: previousMonthLabel,
      },
    };
  }

  /**
   * Categorias que consumiram >= 80% do orcamento mensal definido pelo usuario.
   * Entre 80% e 99% e WARNING; a partir de 100% e CRITICAL (vira notificacao).
   * Um alerta por categoria, dos maiores consumos, no maximo BUDGET_MAX_ALERTS.
   * A chave inclui o mes: no mes seguinte o ciclo recomeca e avisa de novo.
   */
  private detectCategoryBudgets(context: InsightContext): GeneratedInsight[] {
    const spentById = new Map(
      context.categorySpending.current.map((row) => [row.categoryId, row.total]),
    );
    const currency = context.user.preferredCurrency;
    const monthTag = `${context.now.getUTCFullYear()}-${context.now.getUTCMonth() + 1}`;

    return context.categoryBudgets
      .map((category) => {
        const spent = spentById.get(category.categoryId) ?? 0;
        return { ...category, spent, pct: (spent / category.budget) * 100 };
      })
      .filter((category) => category.pct >= BUDGET_NEAR_PCT)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, BUDGET_MAX_ALERTS)
      .map((category) => {
        const over = category.pct >= BUDGET_OVER_PCT;
        const pctLabel = Math.floor(category.pct);
        const spentLabel = this.formatAmount(category.spent, currency);
        const budgetLabel = this.formatAmount(category.budget, currency);

        return {
          type: InsightType.FINANCE,
          key: `budget:${this.hashSubject([category.categoryId, monthTag])}`,
          severity: over ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
          message: over
            ? `${category.name} passou do orcamento deste mes: ${spentLabel} de ${budgetLabel} (${pctLabel}%). Vale rever os proximos gastos ou ajustar o limite.`
            : `${category.name} ja usou ${pctLabel}% do orcamento deste mes (${spentLabel} de ${budgetLabel}). Faltam ${this.formatAmount(category.budget - category.spent, currency)} — vale segurar o ritmo.`,
          metadata: {
            category: category.name,
            budget: category.budget,
            spent: category.spent,
            usedPct: pctLabel,
          },
        } satisfies GeneratedInsight;
      });
  }

  /**
   * Contas fixas de despesa que vencem nos proximos dias. Um unico insight
   * agrupa todas (mais proximas primeiro): varias contas na mesma semana e uma
   * situacao so, e evita inundar o painel. Amanha vira WARNING; antes disso e
   * so um aviso informativo.
   */
  private detectUpcomingBills(context: InsightContext): GeneratedInsight | null {
    const bills = context.upcomingBills;

    if (bills.length === 0) {
      return null;
    }

    const currency = context.user.preferredCurrency;
    const nearest = bills[0];
    const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
    const label = (bill: (typeof bills)[number]) =>
      `${bill.description} (${this.formatAmount(bill.amount, currency)})`;
    const when = (days: number) => (days === 1 ? 'amanha' : `em ${days} dias`);

    let message: string;

    if (bills.length === 1) {
      message = `${label(nearest)} vence ${when(nearest.daysUntil)}. O lancamento entra sozinho no dia; vale garantir o saldo.`;
    } else {
      const listed = bills.slice(0, UPCOMING_BILL_MAX_LISTED).map(label).join(', ');
      const more = bills.length - UPCOMING_BILL_MAX_LISTED;
      message = `${bills.length} contas fixas vencem nos proximos ${UPCOMING_BILL_WINDOW_DAYS} dias, somando ${this.formatAmount(total, currency)}: ${listed}${more > 0 ? ` e mais ${more}` : ''}. A primeira vence ${when(nearest.daysUntil)}.`;
    }

    return {
      type: InsightType.FINANCE,
      key: `upcoming_bills:${this.hashSubject(bills.map((bill) => `${bill.id}@${bill.dueDate.toISOString()}`))}`,
      severity: nearest.daysUntil <= 1 ? InsightSeverity.WARNING : InsightSeverity.INFO,
      message,
      metadata: {
        count: bills.length,
        total,
        nearestDays: nearest.daysUntil,
        bills: bills.slice(0, UPCOMING_BILL_MAX_LISTED).map((bill) => ({
          description: bill.description,
          amount: bill.amount,
          daysUntil: bill.daysUntil,
        })),
      },
    };
  }

  /**
   * Teto de credito do ciclo aberto agora (v. CreditCycleService): mesmos
   * limiares do orcamento por categoria. So dispara com teto definido; um
   * ciclo sem teto (usuario nunca configurou) fica em silencio.
   */
  private detectCreditCycle(context: InsightContext): GeneratedInsight | null {
    const { ceiling, spent, dueDay, closingDate } = context.creditCycle;

    if (ceiling === null || ceiling <= 0) {
      return null;
    }

    const percent = (spent / ceiling) * 100;

    if (percent < CREDIT_CYCLE_NEAR_PCT) {
      return null;
    }

    const over = percent >= CREDIT_CYCLE_OVER_PCT;
    const currency = context.user.preferredCurrency;
    const pctLabel = Math.floor(percent);
    const spentLabel = this.formatAmount(spent, currency);
    const ceilingLabel = this.formatAmount(ceiling, currency);
    const dueLabel = dueDay ? ` A fatura vence dia ${dueDay}.` : '';

    return {
      type: InsightType.FINANCE,
      // Muda a cada ciclo (chave = data de fechamento): o proximo ciclo
      // recomeca do zero e avisa de novo se chegar perto/estourar de novo.
      key: `credit_cycle:${closingDate.toISOString().slice(0, 10)}`,
      severity: over ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
      message: over
        ? `Seu credito passou do teto deste ciclo: ${spentLabel} de ${ceilingLabel} (${pctLabel}%).${dueLabel} Vale rever os proximos gastos ou ajustar o teto.`
        : `Seu credito ja usou ${pctLabel}% do teto deste ciclo (${spentLabel} de ${ceilingLabel}). Faltam ${this.formatAmount(ceiling - spent, currency)}.${dueLabel}`,
      metadata: {
        ceiling,
        spent,
        usedPct: pctLabel,
        dueDay,
      },
    };
  }

  private detectOverdueTasks(context: InsightContext): GeneratedInsight | null {
    const { overdueTasks } = context;

    if (overdueTasks.length === 0) {
      return null;
    }

    return {
      type: InsightType.PRODUCTIVITY,
      key: 'overdue_tasks',
      severity:
        overdueTasks.length >= 3 ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
      message:
        overdueTasks.length >= 3
          ? `Voce tem ${overdueTasks.length} tarefas atrasadas. Vale limpar essa fila hoje para recuperar tracao.`
          : `Existe ${overdueTasks.length} tarefa atrasada. Resolver isso cedo tende a aliviar a semana.`,
      metadata: {
        overdueTasks: overdueTasks.length,
      },
    };
  }

  private detectExpenseRatio(context: InsightContext): GeneratedInsight | null {
    const { monthlyExpenses, monthlyIncome } = context;

    if (monthlyIncome <= 0 || monthlyExpenses < monthlyIncome * 0.85) {
      return null;
    }

    return {
      type: InsightType.FINANCE,
      key: 'expense_ratio',
      severity:
        monthlyExpenses >= monthlyIncome ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
      message:
        monthlyExpenses >= monthlyIncome
          ? 'Suas despesas do mes ja encostaram na sua renda. Vale frear gastos variaveis e revisar contas futuras.'
          : 'Suas despesas do mes ja passaram de 85% da sua renda. Um ajuste leve agora reduz risco no fechamento.',
      metadata: {
        monthlyExpenses,
        monthlyIncome,
      },
    };
  }

  private detectStalledGoals(context: InsightContext): GeneratedInsight | null {
    const { goals, now } = context;

    const stalledGoals = goals.filter((goal) => {
      // Meta sem alvo nao tem "progresso" pra ficar atras: nunca conta como estagnada.
      if (goal.targetAmount === null) return false;

      const targetAmount = Number(goal.targetAmount);
      const currentAmount = Number(goal.currentAmount);
      const progress = targetAmount > 0 ? currentAmount / targetAmount : 0;
      const daysToTarget = goal.targetDate ? differenceInDays(goal.targetDate, now) : null;

      return progress < 0.25 && daysToTarget !== null && daysToTarget <= 60;
    });

    if (stalledGoals.length === 0) {
      return null;
    }

    return {
      type: InsightType.GOAL,
      key: 'stalled_goals',
      severity: InsightSeverity.WARNING,
      message: `${stalledGoals.length} meta(s) estao com pouco progresso para o prazo atual. Talvez seja hora de redistribuir esforco ou aporte.`,
      metadata: {
        stalledGoals: stalledGoals.map((goal) => goal.title),
      },
    };
  }

  /**
   * Usa o birthDate declarado no cadastro/configuracoes. So avisa dentro de
   * uma janela de 7 dias — fora dela nao ha o que fazer com a informacao.
   */
  private detectUpcomingBirthday(context: InsightContext): GeneratedInsight | null {
    const { user, now } = context;

    if (!user.birthDate) {
      return null;
    }

    const daysUntil = this.daysUntilNextBirthday(user.birthDate, now);
    if (daysUntil === null || daysUntil > 7) {
      return null;
    }

    const when = daysUntil === 0 ? 'hoje' : daysUntil === 1 ? 'amanha' : `em ${daysUntil} dias`;

    return {
      type: InsightType.ROUTINE,
      key: 'birthday_soon',
      severity: InsightSeverity.INFO,
      message: `Seu aniversario e ${when}. Bom momento pra revisar metas de vida e comemorar o progresso ate aqui.`,
      metadata: { daysUntil },
    };
  }

  /**
   * birthDate e um campo so-de-data, gravado a meia-noite UTC — ler mes/dia
   * com getMonth()/getDate() (fuso local do processo) pode voltar um dia
   * quando o servidor roda a oeste de UTC (ex: America/Sao_Paulo faz
   * 21/09T00:00Z virar 20/09 as 21h local). getUTCMonth()/getUTCDate()
   * leem o dia civil como foi gravado, sem esse deslize.
   */
  private daysUntilNextBirthday(birthDate: Date, now: Date): number | null {
    if (Number.isNaN(birthDate.getTime())) return null;

    const nextBirthday = new Date(
      now.getFullYear(),
      birthDate.getUTCMonth(),
      birthDate.getUTCDate(),
    );
    if (nextBirthday < startOfDay(now)) {
      nextBirthday.setFullYear(nextBirthday.getFullYear() + 1);
    }

    return differenceInCalendarDays(nextBirthday, now);
  }

  /**
   * O usuario declarou um objetivo principal no cadastro/configuracoes mas
   * ainda nao criou nenhuma meta pra ele — sugere transformar a intencao em
   * algo com prazo e valor. So dispara depois de uma folga de 3 dias (evita
   * cutucar no primeiro acesso).
   */
  private detectPrimaryGoalWithoutTracking(context: InsightContext): GeneratedInsight | null {
    const { user, goals, now } = context;

    if (!user.primaryGoal?.trim() || goals.length > 0) {
      return null;
    }

    if (differenceInDays(now, user.createdAt) < 3) {
      return null;
    }

    return {
      type: InsightType.GOAL,
      key: 'primary_goal_untracked',
      severity: InsightSeverity.WARNING,
      message: `Voce disse, no cadastro, que seu objetivo principal era "${user.primaryGoal.trim().slice(0, 120)}" — ainda nao existe nenhuma meta cadastrada pra isso. Que tal transformar em uma meta com prazo e valor?`,
    };
  }

  private detectBusyDay(context: InsightContext): GeneratedInsight | null {
    const { tasksToday } = context;

    if (tasksToday.length < 4) {
      return null;
    }

    return {
      type: InsightType.ROUTINE,
      key: 'busy_day',
      severity: InsightSeverity.INFO,
      message: `Hoje voce tem ${tasksToday.length} compromissos ativos. Priorize os de maior impacto financeiro e os que destravam outras frentes.`,
      metadata: {
        tasksToday: tasksToday.length,
      },
    };
  }

  private detectRemindersToday(context: InsightContext): GeneratedInsight | null {
    const { remindersToday } = context;

    if (remindersToday.length === 0) {
      return null;
    }

    return {
      type: InsightType.ROUTINE,
      key: 'reminders_today',
      severity: InsightSeverity.INFO,
      message: `Existem ${remindersToday.length} lembrete(s) programados para hoje. Bom dia para operar no modo checklist.`,
      metadata: {
        remindersToday: remindersToday.length,
      },
    };
  }

  /**
   * Dinheiro parado em tarefa adiada.
   *
   * Cruza atraso com impacto financeiro: o usuario ja marcou a tarefa como
   * tendo custo e estimou um valor, entao da para dizer quanto esta preso na
   * fila em vez de so contar quantas tarefas atrasaram.
   */
  private detectOverdueFinancialCost(context: InsightContext): GeneratedInsight | null {
    const costly = context.overdueTasks.filter(
      (task) => task.hasFinancialImpact && task.estimatedAmount !== null,
    );

    if (costly.length === 0) {
      return null;
    }

    const total = costly.reduce((sum, task) => sum + Number(task.estimatedAmount), 0);

    if (total <= 0) {
      return null;
    }

    const { monthlyIncome } = context;
    // Pesa o valor contra a renda quando ela e conhecida: o mesmo valor absoluto
    // significa coisas diferentes para rendas diferentes.
    const isCritical = monthlyIncome > 0 && total >= monthlyIncome * 0.25;
    const amount = this.formatAmount(total, context.user.preferredCurrency);

    return {
      type: InsightType.PRODUCTIVITY,
      key: 'overdue_financial_cost',
      severity: isCritical ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
      message:
        costly.length === 1
          ? `A tarefa ${costly[0].title} esta atrasada e carrega ${amount} de impacto estimado. Adiar isso adia o dinheiro junto.`
          : `Voce tem ${amount} em impacto estimado parado em ${costly.length} tarefas atrasadas. Destravar essas primeiro tende a render mais que o resto da fila.`,
      metadata: {
        totalEstimatedAmount: total,
        tasks: costly.map((task) => ({
          id: task.id,
          title: task.title,
          estimatedAmount: Number(task.estimatedAmount),
        })),
      },
    };
  }

  /**
   * Meta que nao anda por causa de tarefa, nao de dinheiro.
   *
   * detectStalledGoals olha so o progresso e sugere "redistribuir esforco" sem
   * saber o porque. Aqui o vinculo Task.linkedGoalId responde a causa.
   */
  private detectGoalsBlockedByTasks(context: InsightContext): GeneratedInsight | null {
    const blocked = context.goals
      .map((goal) => ({
        goal,
        overdue: context.overdueTasks.filter((task) => task.linkedGoalId === goal.id),
      }))
      .filter((entry) => entry.overdue.length >= 2)
      .sort((a, b) => b.overdue.length - a.overdue.length);

    if (blocked.length === 0) {
      return null;
    }

    const worst = blocked[0];

    return {
      type: InsightType.GOAL,
      key: `goals_blocked_by_tasks:${this.hashSubject(
        blocked.map((entry) => entry.goal.id),
      )}`,
      severity: InsightSeverity.WARNING,
      message:
        blocked.length === 1
          ? `A meta ${worst.goal.title} esta parada por tarefa, nao por dinheiro: ${worst.overdue.length} tarefas ligadas a ela estao atrasadas.`
          : `${blocked.length} metas estao travadas por tarefas atrasadas, a comecar por ${worst.goal.title} com ${worst.overdue.length} pendencias.`,
      metadata: {
        blockedGoals: blocked.map((entry) => ({
          id: entry.goal.id,
          title: entry.goal.title,
          overdueTasks: entry.overdue.length,
        })),
      },
    };
  }

  /**
   * Cobranca repetida: mesma descricao e mesmo valor dentro de poucos dias.
   * Costuma ser cobranca em duplicidade ou lancamento importado duas vezes.
   */
  private detectDuplicateCharges(context: InsightContext): GeneratedInsight | null {
    const duplicates: Array<{
      description: string;
      amount: number;
      occurrences: number;
      lastDate: string;
    }> = [];

    for (const group of this.groupChargesByFingerprint(context.recentExpenses)) {
      const ordered = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());

      let cluster: ChargeOccurrence[] = [];

      for (const charge of ordered) {
        const previous = cluster[cluster.length - 1];

        if (
          previous &&
          differenceInCalendarDays(charge.date, previous.date) > DUPLICATE_WINDOW_DAYS
        ) {
          cluster = [];
        }

        cluster.push(charge);

        if (cluster.length >= 2) {
          duplicates.push({
            description: charge.description,
            amount: charge.amount,
            occurrences: cluster.length,
            lastDate: charge.date.toISOString(),
          });
          break;
        }
      }
    }

    if (duplicates.length === 0) {
      return null;
    }

    const currency = context.user.preferredCurrency;
    const first = duplicates[0];
    const message =
      duplicates.length === 1
        ? `Encontrei uma cobranca repetida: ${first.description} de ${this.formatAmount(first.amount, currency)} aparece ${first.occurrences} vezes em ate ${DUPLICATE_WINDOW_DAYS} dias. Vale conferir se nao foi cobrada em duplicidade.`
        : `Encontrei ${duplicates.length} cobrancas repetidas em ate ${DUPLICATE_WINDOW_DAYS} dias, comecando por ${first.description} de ${this.formatAmount(first.amount, currency)}. Vale conferir se alguma foi cobrada em duplicidade.`;

    return {
      type: InsightType.FINANCE,
      key: `duplicate_charges:${this.hashSubject(
        duplicates.map((entry) => `${entry.description}:${entry.amount}`),
      )}`,
      severity: InsightSeverity.WARNING,
      message,
      metadata: {
        duplicates,
        windowDays: DUPLICATE_WINDOW_DAYS,
      },
    };
  }

  /**
   * Assinatura recorrente: mesma descricao e mesmo valor repetindo em
   * intervalo mensal. Serve para revelar gastos fixos que passam batido.
   */
  private detectRecurringCharges(context: InsightContext): GeneratedInsight | null {
    const subscriptions: Array<{
      description: string;
      amount: number;
      occurrences: number;
      lastDate: string;
    }> = [];

    for (const group of this.groupChargesByFingerprint(context.recentExpenses)) {
      const uniqueDays = this.collapseToUniqueDays(group);

      if (uniqueDays.length < MIN_OCCURRENCES_FOR_SUBSCRIPTION) {
        continue;
      }

      const isMonthly = uniqueDays.every((charge, index) => {
        if (index === 0) {
          return true;
        }

        const gap = differenceInCalendarDays(charge.date, uniqueDays[index - 1].date);

        return gap >= MONTHLY_GAP_MIN_DAYS && gap <= MONTHLY_GAP_MAX_DAYS;
      });

      if (!isMonthly) {
        continue;
      }

      const last = uniqueDays[uniqueDays.length - 1];

      subscriptions.push({
        description: last.description,
        amount: last.amount,
        occurrences: uniqueDays.length,
        lastDate: last.date.toISOString(),
      });
    }

    if (subscriptions.length === 0) {
      return null;
    }

    const currency = context.user.preferredCurrency;
    const monthlyTotal = subscriptions.reduce(
      (total, subscription) => total + subscription.amount,
      0,
    );

    return {
      type: InsightType.FINANCE,
      key: `recurring_charges:${this.hashSubject(
        subscriptions.map((entry) => `${entry.description}:${entry.amount}`),
      )}`,
      severity: InsightSeverity.INFO,
      message:
        subscriptions.length === 1
          ? `Identifiquei uma cobranca recorrente: ${subscriptions[0].description} de ${this.formatAmount(subscriptions[0].amount, currency)} por mes. Vale confirmar se ainda faz sentido manter.`
          : `Identifiquei ${subscriptions.length} cobrancas recorrentes somando ${this.formatAmount(monthlyTotal, currency)} por mes. Vale revisar quais ainda valem a pena.`,
      metadata: {
        subscriptions,
        monthlyTotal,
      },
    };
  }

  /**
   * Compara a ultima nota fiscal de um grupo de tags com a anterior do mesmo
   * grupo: subiu ou caiu no total, qual item pesou mais, qual ficou mais
   * barato, o que entrou e o que saiu da lista.
   *
   * O grupo, escolhido pelo usuario antes do upload, e quem define o que e
   * comparavel com o que — nao o nome do estabelecimento. Duas notas so
   * comparam se estiverem no mesmo grupo, e so quando a nota mais recente do
   * par pediu a comparacao (compareWithPrevious): a comparacao e opcional,
   * nao automatica so por existir um par no mesmo grupo.
   */
  private detectReceiptComparison(context: InsightContext): GeneratedInsight | null {
    const byGroup = new Map<string, ReceiptScanSnapshot[]>();

    for (const scan of context.recentReceiptScans) {
      const group = byGroup.get(scan.tagGroupId);

      if (group) {
        group.push(scan);
        continue;
      }

      byGroup.set(scan.tagGroupId, [scan]);
    }

    const comparisons = [...byGroup.values()]
      .filter((scans) => scans.length >= 2 && scans[0].compareWithPrevious)
      // recentReceiptScans ja vem ordenado por purchaseDate desc da query.
      .map(([current, previous]) => this.compareReceipts(current, previous))
      .sort((a, b) => Math.abs(b.deltaPercent ?? 0) - Math.abs(a.deltaPercent ?? 0));

    if (comparisons.length === 0) {
      return null;
    }

    const lead = comparisons[0];
    const severity =
      lead.deltaPercent !== null && lead.deltaPercent >= RECEIPT_TOTAL_CRITICAL_PCT
        ? InsightSeverity.CRITICAL
        : lead.deltaPercent !== null && lead.deltaPercent >= RECEIPT_TOTAL_WARNING_PCT
          ? InsightSeverity.WARNING
          : InsightSeverity.INFO;

    return {
      type: InsightType.FINANCE,
      key: `receipt_comparison:${this.hashSubject(
        comparisons.map((entry) => entry.tagGroupId),
      )}`,
      severity,
      message: this.describeReceiptComparison(
        lead,
        comparisons.length - 1,
        context.user.preferredCurrency,
      ),
      metadata: {
        comparisons: comparisons.map((entry) => ({
          tagGroup: entry.tagGroupName,
          currentMerchant: entry.currentMerchant,
          previousMerchant: entry.previousMerchant,
          previousTotal: entry.previousTotal,
          currentTotal: entry.currentTotal,
          deltaAmount: entry.deltaAmount,
          deltaPercent: entry.deltaPercent,
          topIncrease: entry.topIncrease,
          topDecrease: entry.topDecrease,
          itemsAdded: entry.itemsAdded,
          itemsRemoved: entry.itemsRemoved,
        })),
      },
    };
  }

  /** Compara duas notas do mesmo grupo de tags, item a item. */
  private compareReceipts(current: ReceiptScanSnapshot, previous: ReceiptScanSnapshot) {
    const previousItems = this.sumItemsByDescription(previous.items);
    const currentItems = this.sumItemsByDescription(current.items);

    let topIncrease: { description: string; previousPrice: number; currentPrice: number } | null =
      null;
    let topDecrease: { description: string; previousPrice: number; currentPrice: number } | null =
      null;

    for (const [normalizedDescription, currentPrice] of currentItems) {
      const previousPrice = previousItems.get(normalizedDescription);

      if (previousPrice === undefined) {
        continue;
      }

      const delta = currentPrice.price - previousPrice.price;

      if (delta > 0 && (!topIncrease || delta > topIncrease.currentPrice - topIncrease.previousPrice)) {
        topIncrease = {
          description: currentPrice.description,
          previousPrice: previousPrice.price,
          currentPrice: currentPrice.price,
        };
      }

      if (delta < 0 && (!topDecrease || delta < topDecrease.currentPrice - topDecrease.previousPrice)) {
        topDecrease = {
          description: currentPrice.description,
          previousPrice: previousPrice.price,
          currentPrice: currentPrice.price,
        };
      }
    }

    const itemsAdded = [...currentItems.keys()]
      .filter((key) => !previousItems.has(key))
      .map((key) => currentItems.get(key)!.description);
    const itemsRemoved = [...previousItems.keys()]
      .filter((key) => !currentItems.has(key))
      .map((key) => previousItems.get(key)!.description);

    const deltaAmount = current.totalAmount - previous.totalAmount;
    const deltaPercent = previous.totalAmount > 0 ? deltaAmount / previous.totalAmount : null;

    return {
      tagGroupId: current.tagGroupId,
      tagGroupName: current.tagGroupName,
      currentMerchant: current.merchantName || null,
      previousMerchant: previous.merchantName || null,
      previousTotal: previous.totalAmount,
      currentTotal: current.totalAmount,
      deltaAmount,
      deltaPercent,
      topIncrease,
      topDecrease,
      itemsAdded,
      itemsRemoved,
    };
  }

  /** Soma o valor de itens repetidos na mesma nota antes de comparar entre notas. */
  private sumItemsByDescription(items: ReceiptItemSnapshot[]) {
    const map = new Map<string, { description: string; price: number }>();

    for (const item of items) {
      const key = item.description.trim().toLowerCase();
      const existing = map.get(key);

      map.set(key, {
        description: item.description,
        price: (existing?.price ?? 0) + item.totalPrice,
      });
    }

    return map;
  }

  private describeReceiptComparison(
    comparison: ReturnType<InsightsService['compareReceipts']>,
    otherGroupsCount: number,
    currency: string,
  ) {
    const currentAmount = this.formatAmount(comparison.currentTotal, currency);
    const previousAmount = this.formatAmount(comparison.previousTotal, currency);
    const trendWord = comparison.deltaAmount > 0 ? 'subiu' : comparison.deltaAmount < 0 ? 'caiu' : 'ficou igual';
    const percentText =
      comparison.deltaPercent !== null
        ? ` (${trendWord} ${Math.round(Math.abs(comparison.deltaPercent) * 100)}%)`
        : '';
    // O grupo pode ter notas de estabelecimentos diferentes (ex.: "Compras do
    // mes" cobrindo mais de um mercado). So cita o nome quando ele existe e
    // ajuda a identificar a nota — nunca repete o mesmo nome duas vezes.
    const currentSuffix = comparison.currentMerchant ? ` (${comparison.currentMerchant})` : '';
    const previousSuffix =
      comparison.previousMerchant && comparison.previousMerchant !== comparison.currentMerchant
        ? ` (${comparison.previousMerchant})`
        : '';

    let message = `Na comparacao do grupo ${comparison.tagGroupName}, a nota mais recente${currentSuffix} ficou em ${currentAmount}${percentText} em relacao a nota anterior${previousSuffix} de ${previousAmount}.`;

    if (comparison.topIncrease) {
      message += ` Onde voce gastou mais: ${comparison.topIncrease.description}, que foi de ${this.formatAmount(comparison.topIncrease.previousPrice, currency)} para ${this.formatAmount(comparison.topIncrease.currentPrice, currency)}.`;
    }

    if (comparison.topDecrease) {
      message += ` Onde voce ja melhorou: ${comparison.topDecrease.description} ficou mais barato, ajudando a segurar o total.`;
    } else if (comparison.itemsRemoved.length > 0 && comparison.deltaAmount <= 0) {
      message += ` Deixar de levar ${comparison.itemsRemoved.slice(0, 2).join(' e ')} ajudou a segurar o gasto — bom espaco pra repetir.`;
    } else if (comparison.itemsAdded.length > 0) {
      message += ` Novo nessa compra: ${comparison.itemsAdded.slice(0, 2).join(', ')}.`;
    }

    if (otherGroupsCount > 0) {
      message += ` Tambem notei variacao em outro${otherGroupsCount > 1 ? 's' : ''} ${otherGroupsCount} grupo${otherGroupsCount > 1 ? 's' : ''} com comparacao ativada.`;
    }

    return message;
  }

  /**
   * Agrupa despesas por descricao normalizada e valor, no mesmo espirito do
   * fingerprint usado na deduplicacao de importacao de CSV.
   */
  private groupChargesByFingerprint(charges: ChargeOccurrence[]): ChargeOccurrence[][] {
    const groups = new Map<string, ChargeOccurrence[]>();

    for (const charge of charges) {
      const fingerprint = `${charge.description.trim().toLowerCase()}:${charge.amount}`;
      const group = groups.get(fingerprint);

      if (group) {
        group.push(charge);
        continue;
      }

      groups.set(fingerprint, [charge]);
    }

    return [...groups.values()].filter((group) => group.length > 1);
  }

  /**
   * Mantem uma ocorrencia por dia, em ordem crescente, para que uma cobranca
   * duplicada no mesmo dia nao seja confundida com ciclo de assinatura.
   */
  private collapseToUniqueDays(charges: ChargeOccurrence[]): ChargeOccurrence[] {
    const byDay = new Map<string, ChargeOccurrence>();

    for (const charge of charges) {
      const dayKey = startOfDay(charge.date).toISOString();

      if (!byDay.has(dayKey)) {
        byDay.set(dayKey, charge);
      }
    }

    return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private formatAmount(amount: number, currency: string) {
    try {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency,
      }).format(amount);
    } catch {
      return amount.toFixed(2);
    }
  }
}
