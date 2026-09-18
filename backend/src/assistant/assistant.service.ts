import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TransactionType } from "@prisma/client";
import { randomUUID } from "crypto";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { DashboardService } from "../dashboard/dashboard.service";
import { CreateGoalDto } from "../goals/dto/create-goal.dto";
import { GoalsService } from "../goals/goals.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateReminderDto } from "../reminders/dto/create-reminder.dto";
import { RemindersService } from "../reminders/reminders.service";
import { CreateTaskDto } from "../tasks/dto/create-task.dto";
import { TasksService } from "../tasks/tasks.service";
import { ApplyAssistantActionDto } from "./dto/apply-assistant-action.dto";
import { AskAssistantHistoryItemDto } from "./dto/ask-assistant.dto";
import { SaveAssistantTurnDto } from "./dto/save-assistant-turn.dto";

type AssistantConfidence = "low" | "medium" | "high";

type DashboardSummary = {
  user: {
    id?: string;
    name: string;
    preferredCurrency: string;
    monthlyIncome: number;
    birthDate?: Date | string | null;
    occupation?: string | null;
    primaryGoal?: string | null;
  };
  tasks: {
    todayCount: number;
    overdueCount: number;
    items: Array<{
      title: string;
      dueDate?: Date | string | null;
      priority?: string | null;
      hasFinancialImpact?: boolean | null;
      estimatedAmount?: number | null;
      category?: {
        name: string;
      } | null;
    }>;
  };
  finances: {
    balance: number;
    monthlyExpenses: number;
    monthlyIncome: number;
    recentTransactions: Array<{
      description: string;
      type: string;
      amount: number;
      date: Date | string;
      category?: {
        name: string;
      } | null;
    }>;
  };
  goals: Array<{
    title: string;
    currentAmount: number;
    targetAmount: number;
    status: string;
    targetDate?: Date | string | null;
  }>;
  reminders: Array<{
    title: string;
    remindAt: Date | string;
  }>;
  insights: Array<{
    type: string;
    message: string;
    severity: string;
    /** type:key:severity, ver InsightsService.fingerprintOf */
    fingerprint?: string;
    metadata?: { persona?: { name?: string; role?: string } } | null;
  }>;
  forecast: {
    predictedBalance: number;
    riskLevel: string;
  };
  notifications: Array<{
    title: string;
    message: string;
  }>;
};

type AssistantActionKind =
  | "create_task"
  | "create_goal"
  | "create_reminder"
  | "open_module";

type AssistantModule =
  | "dashboard"
  | "tasks"
  | "finances"
  | "goals"
  | "imports"
  | "general";

type AssistantActionImportance = "low" | "medium" | "high";

type AssistantAction = {
  id: string;
  kind: AssistantActionKind;
  title: string;
  description: string;
  targetModule: AssistantModule;
  importance: AssistantActionImportance;
  route: string | null;
  payload: Record<string, unknown> | null;
};

type AssistantProactiveSignalSeverity = "info" | "warning" | "critical";

type AssistantProactiveSignal = {
  id: string;
  title: string;
  message: string;
  severity: AssistantProactiveSignalSeverity;
  targetModule: AssistantModule;
  suggestedPrompt: string | null;
  suggestedActionLabel: string | null;
};

/**
 * Analise real de transacoes dos ultimos 3 meses, calculada uma vez em
 * ask() e reusada em buildSimulations — troca os fixos "10% de corte" e
 * "8 meses de parcela" por numeros baseados no historico de cada usuario.
 */
type SpendingAnalysis = {
  topVariableCategory: { name: string; total: number } | null;
  avgMonthlySurplus: number | null;
};

type AssistantSimulation = {
  id: string;
  title: string;
  summary: string;
  monthlyDelta: number;
  projectedBalance: number;
  confidence: AssistantConfidence;
  assumptions: string[];
};

type AssistantContinuity = {
  historyCount: number;
  memorySummary: string | null;
  nextQuestion: string | null;
  followUpPrompt: string | null;
  originModule: AssistantModule | null;
};

type AssistantExplainability = {
  reasoning: string[];
  evidence: string[];
  confidenceReason: string;
};

type AssistantPulse = {
  summary: string;
  suggestedQuestion: string;
  generatedAt: string;
  signals: AssistantProactiveSignal[];
  actions: AssistantAction[];
};

type AssistantReply = {
  answer: string;
  highlights: string[];
  suggestedActions: string[];
  actions: AssistantAction[];
  proactiveSignals: AssistantProactiveSignal[];
  simulations: AssistantSimulation[];
  continuity: AssistantContinuity;
  explainability: AssistantExplainability;
  source: "selah_ia" | "lumen_fallback";
  provider: string;
  focusArea: string;
  confidence: AssistantConfidence;
  disclaimer: string | null;
  generatedAt: string;
  model?: string;
};

type SelahResponse = {
  answer?: unknown;
  highlights?: unknown;
  suggestedActions?: unknown;
  focusArea?: unknown;
  confidence?: unknown;
  disclaimer?: unknown;
  provider?: unknown;
  model?: unknown;
  generatedAt?: unknown;
  reasoning?: unknown;
  evidence?: unknown;
  confidenceReason?: unknown;
  followUpPrompt?: unknown;
};

type AssistantPrivacySettings = {
  privacyNoticeAcceptedAt: Date | null;
  aiAssistantEnabled: boolean;
  aiAssistantConsentAt: Date | null;
};

type SelahAttemptReason =
  | "privacy_notice_missing"
  | "ai_consent_missing"
  | "integration_disabled"
  | "selah_unavailable"
  | null;

const ASSISTANT_REPLY_LIST_LIMIT = 6;

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  // Runtime bridge between LUMEN and SelahIA with safe local fallback.

  constructor(
    private readonly dashboardService: DashboardService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly goalsService: GoalsService,
    private readonly remindersService: RemindersService,
  ) {}

  async ask(
    userId: string,
    question: string,
    options?: {
      history?: AskAssistantHistoryItemDto[];
      originModule?: AssistantModule;
    },
  ): Promise<AssistantReply> {
    const [summary, privacySettings, spendingAnalysis] = await Promise.all([
      this.dashboardService.getSummary(userId) as Promise<DashboardSummary>,
      this.loadPrivacySettings(userId),
      this.analyzeSpending(userId),
    ]);
    const selahResult = await this.askSelah(
      summary,
      privacySettings,
      question,
      options?.history || [],
      options?.originModule || "general",
    );
    const generatedAt = new Date().toISOString();

    if (selahResult.reply) {
      return this.enrichReply(
        summary,
        question,
        selahResult.reply,
        options?.history || [],
        options?.originModule || "general",
        generatedAt,
        spendingAnalysis,
      );
    }

    return this.enrichReply(
      summary,
      question,
      this.buildLocalReply(
        summary,
        question,
        this.resolveLocalDisclaimer(selahResult.reason),
      ),
      options?.history || [],
      options?.originModule || "general",
      generatedAt,
      spendingAnalysis,
    );
  }

  async getPulse(userId: string): Promise<AssistantPulse> {
    const summary = (await this.dashboardService.getSummary(
      userId,
    )) as DashboardSummary;
    const generatedAt = new Date().toISOString();
    const signals = this.buildProactiveSignals(summary, "", "dashboard");
    const actions = this.buildActionSuggestions(
      summary,
      "",
      "dashboard",
      "Panorama",
    ).slice(0, 3);

    return {
      summary: this.buildPulseSummary(summary, signals),
      suggestedQuestion: this.buildPulseQuestion(summary),
      generatedAt,
      signals,
      actions,
    };
  }

  async listHistory(userId: string, limit = 20) {
    const turns = await this.prisma.assistantTurn.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        question: true,
        answer: true,
        focusArea: true,
        source: true,
        createdAt: true,
      },
    });

    return turns;
  }

  async saveHistoryTurn(userId: string, dto: SaveAssistantTurnDto) {
    const turn = await this.prisma.assistantTurn.create({
      data: {
        userId,
        question: dto.question.slice(0, 2000),
        answer: dto.answer.slice(0, 8000),
        focusArea: dto.focusArea ?? null,
        source: dto.source ?? null,
      },
      select: {
        id: true,
        question: true,
        answer: true,
        focusArea: true,
        source: true,
        createdAt: true,
      },
    });

    return turn;
  }

  async applyAction(userId: string, dto: ApplyAssistantActionDto) {
    if (dto.kind === "open_module") {
      return {
        success: true,
        kind: dto.kind,
        route: dto.route || null,
      };
    }

    const payload = dto.payload || {};

    if (dto.kind === "create_task") {
      return {
        success: true,
        kind: dto.kind,
        entity: await this.tasksService.create(
          userId,
          this.toCreateTaskDto(dto.title, payload),
        ),
      };
    }

    if (dto.kind === "create_goal") {
      return {
        success: true,
        kind: dto.kind,
        entity: await this.goalsService.create(
          userId,
          this.toCreateGoalDto(dto.title, payload),
        ),
      };
    }

    if (dto.kind === "create_reminder") {
      return {
        success: true,
        kind: dto.kind,
        entity: await this.remindersService.create(
          userId,
          this.toCreateReminderDto(dto.title, payload),
        ),
      };
    }

    throw new BadRequestException("Acao do assistente nao suportada.");
  }

  private async askSelah(
    summary: DashboardSummary,
    privacySettings: AssistantPrivacySettings,
    question: string,
    history: AskAssistantHistoryItemDto[],
    originModule: AssistantModule,
  ): Promise<{
    reply: AssistantReply | null;
    attempted: boolean;
    reason: SelahAttemptReason;
  }> {
    if (!privacySettings.privacyNoticeAcceptedAt) {
      return {
        reply: null,
        attempted: false,
        reason: "privacy_notice_missing",
      };
    }

    if (
      !privacySettings.aiAssistantEnabled ||
      !privacySettings.aiAssistantConsentAt
    ) {
      return { reply: null, attempted: false, reason: "ai_consent_missing" };
    }

    const enabled = this.readBooleanEnv("SELAH_ASSISTANT_ENABLED");
    const baseUrl = this.readEnv("SELAH_BASE_URL");

    if (!enabled || !baseUrl) {
      return { reply: null, attempted: false, reason: "integration_disabled" };
    }

    const route =
      this.readEnv("SELAH_ASSISTANT_ROUTE") ||
      "/v1/adapters/lumen/life-assistant/chat";
    const apiKey = this.readEnv("SELAH_API_KEY");
    const sourceApp = this.readEnv("SELAH_SOURCE_APP") || "LumenBack";
    const timeoutMs = this.readTimeout();
    const url = `${baseUrl.replace(/\/+$/, "")}${route.startsWith("/") ? route : `/${route}`}`;
    const requestId = randomUUID();
    const body = JSON.stringify(
      this.buildSelahPayload(summary, question, history, originModule),
    );

    try {
      const response = await this.postJson(
        url,
        body,
        {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
          "X-Source-App": sourceApp,
          "X-Request-Id": requestId,
          ...(apiKey ? { "X-Selah-Api-Key": apiKey } : {}),
        },
        timeoutMs,
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        this.logger.warn(
          `[${requestId}] SelahIA respondeu com erro ${response.statusCode}: ${response.body.slice(0, 240)}`,
        );
        return { reply: null, attempted: true, reason: "selah_unavailable" };
      }

      let payload: SelahResponse;

      try {
        payload = JSON.parse(response.body) as SelahResponse;
      } catch (_error) {
        this.logger.warn(
          `[${requestId}] SelahIA retornou um payload invalido: ${response.body.slice(0, 240)}`,
        );
        return { reply: null, attempted: true, reason: "selah_unavailable" };
      }

      return {
        reply: this.normalizeSelahReply(payload),
        attempted: true,
        reason: null,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erro desconhecido no SelahIA.";
      this.logger.warn(`[${requestId}] Falha ao consultar SelahIA: ${message}`);
      return { reply: null, attempted: true, reason: "selah_unavailable" };
    }
  }

  private buildSelahPayload(
    summary: DashboardSummary,
    question: string,
    history: AskAssistantHistoryItemDto[],
    originModule: AssistantModule,
  ) {
    const currency = this.currency(summary);
    const intent = this.detectIntent(question);
    const firstName = this.extractFirstName(summary.user.name);

    return {
      message: this.sanitizeExternalText(question),
      intent,
      questionContextSummary: this.buildQuestionContextSummary(summary, question),
      matchedQuestionTargets: this.matchQuestionTargets(summary, question),
      currentDateLabel: new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      }).format(new Date()),
      user: {
        name: firstName,
        preferredCurrency: currency,
        monthlyIncome: summary.user.monthlyIncome,
      },
      lifeContextSummary: this.buildLifeContextSummary(summary),
      applicationPromptContext: this.buildApplicationPromptContext(
        summary,
        intent,
      ),
      conversationMemory: this.buildConversationMemory(history),
      originModule,
      focusAreaHint: this.resolveFocusArea(intent),
      tasksTodayCount: summary.tasks.todayCount,
      tasksOverdueCount: summary.tasks.overdueCount,
      currentBalance: summary.finances.balance,
      monthlyExpenses: summary.finances.monthlyExpenses,
      monthlyIncome: summary.finances.monthlyIncome,
      forecast: {
        predictedBalance: Number(summary.forecast.predictedBalance ?? 0),
        riskLevel: String(summary.forecast.riskLevel || "MEDIUM"),
      },
      openTasks: summary.tasks.items.slice(0, 5).map((task) => ({
        title: this.sanitizeExternalText(task.title),
        priority: this.formatEnumLabel(task.priority),
        dueDateLabel: this.formatDate(task.dueDate),
        category: task.category?.name
          ? this.sanitizeExternalText(task.category.name)
          : undefined,
        hasFinancialImpact: Boolean(task.hasFinancialImpact),
        estimatedAmount:
          task.estimatedAmount !== null && task.estimatedAmount !== undefined
            ? Number(task.estimatedAmount)
            : undefined,
      })),
      recentTransactions: summary.finances.recentTransactions
        .slice(0, 5)
        .map((transaction) => ({
          description: this.sanitizeExternalText(transaction.description),
          type: this.formatEnumLabel(transaction.type),
          amount: Number(transaction.amount),
          dateLabel: this.formatDate(transaction.date),
          category: transaction.category?.name
            ? this.sanitizeExternalText(transaction.category.name)
            : undefined,
        })),
      activeGoals: summary.goals.slice(0, 4).map((goal) => ({
        title: this.sanitizeExternalText(goal.title),
        status: this.formatEnumLabel(goal.status),
        progressPercent: this.goalProgress(goal),
        targetDateLabel: this.formatDate(goal.targetDate),
      })),
      activeInsights: summary.insights.slice(0, 5).map((insight) => ({
        type: this.formatEnumLabel(insight.type),
        severity: this.formatEnumLabel(insight.severity),
        message: this.sanitizeExternalText(insight.message),
      })),
      reminderLabels: summary.reminders
        .slice(0, 4)
        .map(
          (reminder) =>
            `${this.sanitizeExternalText(reminder.title)} em ${this.formatDateTime(reminder.remindAt)}`,
        ),
      notificationLabels: summary.notifications
        .slice(0, 4)
        .map(
          (notification) =>
            `${this.sanitizeExternalText(notification.title)}: ${this.sanitizeExternalText(notification.message)}`,
        ),
    };
  }

  private normalizeSelahReply(payload: SelahResponse): AssistantReply | null {
    const answer =
      typeof payload.answer === "string" ? payload.answer.trim() : "";

    if (!answer) {
      return null;
    }

    return {
      answer,
      highlights: this.readStringList(
        payload.highlights,
        ASSISTANT_REPLY_LIST_LIMIT,
      ),
      suggestedActions: this.readStringList(
        payload.suggestedActions,
        ASSISTANT_REPLY_LIST_LIMIT,
      ),
      actions: [],
      proactiveSignals: [],
      simulations: [],
      continuity: {
        historyCount: 0,
        memorySummary: null,
        nextQuestion: null,
        followUpPrompt:
          typeof payload.followUpPrompt === "string" &&
          payload.followUpPrompt.trim()
            ? payload.followUpPrompt.trim()
            : null,
        originModule: null,
      },
      explainability: {
        reasoning: this.readStringList(payload.reasoning, 4),
        evidence: this.readStringList(payload.evidence, 5),
        confidenceReason:
          typeof payload.confidenceReason === "string" &&
          payload.confidenceReason.trim()
            ? payload.confidenceReason.trim()
            : "",
      },
      source: "selah_ia",
      provider:
        typeof payload.provider === "string" && payload.provider.trim()
          ? payload.provider.trim()
          : "SelahIA",
      focusArea:
        typeof payload.focusArea === "string" && payload.focusArea.trim()
          ? payload.focusArea.trim()
          : "Visao geral",
      confidence: this.normalizeConfidence(payload.confidence),
      disclaimer:
        typeof payload.disclaimer === "string" && payload.disclaimer.trim()
          ? payload.disclaimer.trim()
          : null,
      generatedAt:
        typeof payload.generatedAt === "string" && payload.generatedAt.trim()
          ? payload.generatedAt.trim()
          : new Date().toISOString(),
      model:
        typeof payload.model === "string" && payload.model.trim()
          ? payload.model.trim()
          : undefined,
    };
  }

  private buildLocalReply(
    summary: DashboardSummary,
    question: string,
    disclaimer: string | null,
  ): AssistantReply {
    const intent = this.detectIntent(question);
    const currency = this.currency(summary);
    const criticalInsights = summary.insights.filter(
      (insight) => insight.severity === "CRITICAL",
    );
    const nextTasks = summary.tasks.items.slice(0, 3);
    const goals = summary.goals.slice(0, 2);
    const focusArea = this.resolveFocusArea(intent);

    let answer = "";

    if (intent === "priorities") {
      const priorities = nextTasks
        .map(
          (task) =>
            `${task.title}${task.dueDate ? ` (${this.formatDate(task.dueDate)})` : ""}`,
        )
        .join(", ");

      answer =
        `Hoje eu puxaria a fila por ${priorities || "tarefas sem prazo imediato"}. ` +
        "Comece pelo que vence antes, tem impacto financeiro ou destrava o resto do dia.";
    } else if (intent === "finance_overview") {
      answer =
        `Seu saldo atual esta em ${this.formatCurrency(summary.finances.balance, currency)}. ` +
        `Neste mes voce movimentou ${this.formatCurrency(summary.finances.monthlyIncome, currency)} em entradas, ` +
        `${this.formatCurrency(summary.finances.monthlyExpenses, currency)} em saidas ` +
        `e a previsao aponta risco ${String(summary.forecast.riskLevel).toLowerCase()}.`;
    } else {
      answer =
        `Hoje voce tem ${summary.tasks.todayCount} tarefa(s) para o dia, ${summary.tasks.overdueCount} atrasada(s) e ` +
        `${criticalInsights.length > 0 ? `${criticalInsights.length} alerta(s) critico(s)` : "nenhum alerta critico"}. ` +
        `A previsao financeira atual esta em ${this.formatCurrency(Number(summary.forecast.predictedBalance ?? 0), currency)}.`;
    }

    return {
      answer,
      highlights: this.ensureHighlights([
        ...criticalInsights.map((insight) => insight.message),
        ...goals.map(
          (goal) =>
            `Meta ${goal.title}: ${this.goalProgress(goal)}% concluida.`,
        ),
      ]),
      suggestedActions: this.ensureActions([
        nextTasks[0] ? `Fechar a tarefa "${nextTasks[0].title}" hoje.` : null,
        summary.tasks.overdueCount > 0
          ? "Eliminar pelo menos uma pendencia atrasada."
          : null,
        summary.forecast.riskLevel === "HIGH"
          ? "Revisar despesas futuras e congelar gastos nao essenciais."
          : "Manter o ritmo atual e reforcar uma meta ativa.",
      ]),
      actions: [],
      proactiveSignals: [],
      simulations: [],
      continuity: {
        historyCount: 0,
        memorySummary: null,
        nextQuestion: null,
        followUpPrompt: null,
        originModule: null,
      },
      explainability: {
        reasoning: [],
        evidence: [],
        confidenceReason: "",
      },
      source: "lumen_fallback",
      provider: "LUMEN Local",
      focusArea,
      confidence: "medium",
      disclaimer,
      generatedAt: new Date().toISOString(),
    };
  }

  private enrichReply(
    summary: DashboardSummary,
    question: string,
    reply: AssistantReply,
    history: AskAssistantHistoryItemDto[],
    originModule: AssistantModule,
    generatedAt: string,
    spendingAnalysis: SpendingAnalysis,
  ): AssistantReply {
    const focusArea = reply.focusArea || this.resolveFocusArea(this.detectIntent(question));
    const continuity = this.buildContinuity(
      summary,
      question,
      reply,
      history,
      originModule,
    );

    return {
      ...reply,
      generatedAt: reply.generatedAt || generatedAt,
      actions: this.buildActionSuggestions(summary, question, originModule, focusArea),
      proactiveSignals: this.buildProactiveSignals(summary, question, originModule),
      simulations: this.buildSimulations(summary, question, spendingAnalysis),
      continuity,
      explainability: this.buildExplainability(summary, question, reply, continuity),
    };
  }

  private buildConversationMemory(history: AskAssistantHistoryItemDto[]) {
    const recentHistory = history
      .slice(0, 3)
      .map((item, index) => {
        const question = this.sanitizeExternalText(item.question);
        const answer = this.sanitizeExternalText(item.answer).slice(0, 160);
        const focusArea = item.focusArea ? ` foco ${item.focusArea}` : "";
        return `${index + 1}. Pergunta:${focusArea} ${question}. Resposta anterior: ${answer}.`;
      })
      .filter(Boolean);

    if (!recentHistory.length) {
      return null;
    }

    return recentHistory.join(" ");
  }

  private buildActionSuggestions(
    summary: DashboardSummary,
    question: string,
    originModule: AssistantModule,
    focusArea: string,
  ) {
    const actions: AssistantAction[] = [];
    const tomorrowMorning = this.nextReminderDate(1, 9);
    const topTask = summary.tasks.items[0];
    const topGoal = summary.goals[0];
    const normalizedQuestion = this.normalizeForMatch(question);
    const financeHeavy =
      focusArea.toLowerCase().includes("financ") ||
      normalizedQuestion.includes("divid") ||
      normalizedQuestion.includes("saldo") ||
      normalizedQuestion.includes("gasto") ||
      summary.forecast.riskLevel === "HIGH";

    if (financeHeavy) {
      actions.push(
        this.createAction("create_task", {
          title: "Mapear dívidas, juros e parcelas",
          description:
            "Transforma a orientação do Selah em uma tarefa concreta dentro da sua rotina.",
          targetModule: "tasks",
          importance: "high",
          payload: {
            title: "Mapear dividas, juros e parcelas",
            description:
              "Levantar credores, valor em aberto, juros, atraso e ordem de negociacao.",
            priority: "HIGH",
            dueDate: this.nextDateInputValue(1),
            hasFinancialImpact: false,
          },
        }),
      );
      actions.push(
        this.createAction("create_reminder", {
          title: "Criar lembrete de revisão de caixa",
          description:
            "Agenda um checkpoint rápido para você confirmar se o plano saiu do papel.",
          targetModule: "finances",
          importance: "medium",
          payload: {
            title: "Revisar caixa e contas da semana",
            remindAt: tomorrowMorning,
          },
        }),
      );
    }

    if (summary.tasks.overdueCount > 0) {
      actions.push(
        this.createAction("open_module", {
          title: "Abrir fila de tarefas",
          description:
            "Leva você direto para as pendências que estão pressionando o dia.",
          targetModule: "tasks",
          importance: summary.tasks.overdueCount >= 3 ? "high" : "medium",
          route: "/tasks",
          payload: null,
        }),
      );
    } else if (topTask) {
      actions.push(
        this.createAction("create_reminder", {
          title: `Lembrar "${topTask.title}"`,
          description:
            "Cria um lembrete para sustentar a prioridade mais concreta da sua fila.",
          targetModule: "tasks",
          importance: "medium",
          payload: {
            title: `Revisar ${topTask.title}`,
            remindAt: this.nextReminderDate(0, 18),
          },
        }),
      );
    }

    if (!summary.goals.length && financeHeavy) {
      const targetAmount = Math.max(
        Math.round(summary.finances.monthlyExpenses || summary.user.monthlyIncome || 1000),
        1000,
      );
      actions.push(
        this.createAction("create_goal", {
          title: "Criar meta de reserva",
          description:
            "Abre uma meta base para proteger o caixa enquanto você reorganiza o mês.",
          targetModule: "goals",
          importance: "medium",
          payload: {
            title: "Reserva de seguranca",
            description:
              "Meta inicial criada a partir do contexto financeiro atual do LUMEN.",
            targetAmount,
            currentAmount: 0,
            targetDate: this.nextDateInputValue(90),
          },
        }),
      );
    } else if (topGoal) {
      actions.push(
        this.createAction("open_module", {
          title: `Ver meta ${topGoal.title}`,
          description:
            "Abre sua carteira de metas para decidir se vale reforçar prazo ou aporte.",
          targetModule: "goals",
          importance: "low",
          route: "/goals",
          payload: null,
        }),
      );
    }

    if (originModule === "imports") {
      actions.unshift(
        this.createAction("open_module", {
          title: "Voltar para importações",
          description:
            "Retorna para a compra ou nota que motivou esta conversa com o Selah.",
          targetModule: "imports",
          importance: "medium",
          route: "/imports",
          payload: null,
        }),
      );
    }

    return actions.slice(0, 4);
  }

  /**
   * Modulo, pergunta de acompanhamento e rotulo de acao sugeridos por tipo de
   * insight. O motor de insights nao carrega essas tres coisas (fala so em
   * modulo de dominio, nao em UX de chat), entao ficam aqui, num unico lugar.
   */
  private readonly INSIGHT_SIGNAL_HINTS: Record<
    string,
    { targetModule: AssistantModule | null; suggestedPrompt: string; suggestedActionLabel: string }
  > = {
    PRODUCTIVITY: {
      targetModule: "tasks",
      suggestedPrompt: "Quais pendências atrasadas eu devo limpar primeiro?",
      suggestedActionLabel: "Abrir tarefas",
    },
    FINANCE: {
      targetModule: "finances",
      suggestedPrompt: "O que eu preciso proteger primeiro no meu caixa este mês?",
      suggestedActionLabel: "Olhar finanças",
    },
    GOAL: {
      targetModule: "goals",
      suggestedPrompt: "Como destravar minhas metas travadas?",
      suggestedActionLabel: "Rever metas",
    },
    // ROUTINE nao tem modulo proprio: fica no modulo de onde a pergunta partiu
    // (ou "dashboard" no pulso, sem pergunta), em vez de sempre mandar pro
    // dashboard mesmo quando o usuario esta conversando a partir de outra tela.
    ROUTINE: {
      targetModule: null,
      suggestedPrompt: "Onde vale colocar energia para ganhar mais tração esta semana?",
      suggestedActionLabel: "Conversar com Selah",
    },
  };

  /**
   * Traduz os insights do motor (summary.insights, ja carimbados com persona
   * e severidade) em sinais proativos do chat/pulso.
   *
   * Antes esse metodo reimplementava manualmente 3 das regras que o motor de
   * insights ja calcula (tarefas atrasadas, meta travada, janela calma), com
   * thresholds levemente diferentes dos do motor. Isso significava que todo
   * detector novo em insights.service (cobranca duplicada, assinatura,
   * impacto financeiro atrasado, meta bloqueada por tarefa) ficava invisivel
   * aqui, so aparecendo no dashboard e no texto corrido da resposta.
   *
   * O risco de caixa fica de fora do mapeamento porque vem de Forecast, uma
   * entidade separada de Insight — nao ha detector equivalente no motor.
   */
  private buildProactiveSignals(
    summary: DashboardSummary,
    question: string,
    originModule: AssistantModule,
  ) {
    const signals: AssistantProactiveSignal[] = [];
    const hasQuestion = Boolean(String(question || "").trim());

    if (summary.forecast.riskLevel === "HIGH") {
      signals.push({
        id: "cash-risk",
        title: "Caixa sob pressão",
        message: `A projeção atual fecha em ${this.formatCurrency(
          Number(summary.forecast.predictedBalance ?? 0),
          this.currency(summary),
        )}, então vale revisar saídas variáveis antes que o mês aperte de vez.`,
        severity: "critical",
        targetModule: "finances",
        suggestedPrompt: "O que eu preciso proteger primeiro no meu caixa este mês?",
        suggestedActionLabel: "Olhar finanças",
      });
    }

    const relevantInsights = summary.insights.filter((insight) => {
      // O fallback "tudo calmo" e util no pulso vazio, mas polui a leitura
      // quando o usuario ja fez uma pergunta especifica.
      const isCalmFallback = insight.fingerprint?.split(":")[1] === "calm";

      return !(hasQuestion && isCalmFallback);
    });

    for (const insight of relevantInsights) {
      const hints =
        this.INSIGHT_SIGNAL_HINTS[insight.type] ?? this.INSIGHT_SIGNAL_HINTS.ROUTINE;
      const persona = insight.metadata?.persona?.name;

      signals.push({
        id: insight.fingerprint ?? `insight-${insight.type.toLowerCase()}`,
        title: persona ?? this.formatEnumLabel(insight.type),
        message: insight.message,
        severity: this.mapInsightSeverity(insight.severity),
        targetModule: hints.targetModule ?? originModule,
        suggestedPrompt: hints.suggestedPrompt,
        suggestedActionLabel: hints.suggestedActionLabel,
      });
    }

    return signals.slice(0, 3);
  }

  private mapInsightSeverity(severity: string): AssistantProactiveSignalSeverity {
    if (severity === "CRITICAL") {
      return "critical";
    }

    if (severity === "WARNING") {
      return "warning";
    }

    return "info";
  }

  /**
   * Analisa transacoes reais dos ultimos 3 meses pra alimentar as
   * simulacoes: qual categoria de gasto variavel tem mais folga pra cortar
   * (em vez de "10% fixo" generico), e qual a sobra media mensal real do
   * usuario (em vez de "8 meses fixo" pra qualquer divida).
   */
  private async analyzeSpending(userId: string): Promise<SpendingAnalysis> {
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 2, 1);

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: since },
        type: { in: [TransactionType.INCOME, TransactionType.EXPENSE, TransactionType.TRANSFER] },
      },
      select: {
        type: true,
        amount: true,
        date: true,
        category: { select: { name: true } },
      },
    });

    const monthIndexOf = (date: Date) =>
      (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());

    // Sobra media mensal real (entradas - saidas - transferencias), mesma
    // convencao de sinal usada no resto do app (ForecastsService, saldo do
    // dashboard): so INCOME e positivo.
    const monthlyNet = [0, 0, 0];
    for (const transaction of transactions) {
      const index = monthIndexOf(new Date(transaction.date));
      if (index < 0 || index > 2) continue;

      const amount = Number(transaction.amount);
      monthlyNet[index] += transaction.type === TransactionType.INCOME ? amount : -amount;
    }
    const avgMonthlySurplus = monthlyNet.reduce((sum, value) => sum + value, 0) / 3;

    // Categoria de maior gasto variavel: agrupa EXPENSE por categoria em
    // baldes mensais e descarta quem tem pouca oscilacao (provavel conta
    // fixa, tipo aluguel) antes de escolher a de maior total.
    const categoryBuckets = new Map<string, number[]>();
    for (const transaction of transactions) {
      if (transaction.type !== TransactionType.EXPENSE || !transaction.category?.name) continue;

      const index = monthIndexOf(new Date(transaction.date));
      if (index < 0 || index > 2) continue;

      const name = transaction.category.name;
      const bucket = categoryBuckets.get(name) ?? [0, 0, 0];
      bucket[index] += Number(transaction.amount);
      categoryBuckets.set(name, bucket);
    }

    let topVariableCategory: SpendingAnalysis["topVariableCategory"] = null;
    for (const [name, monthly] of categoryBuckets) {
      const total = monthly.reduce((sum, value) => sum + value, 0);
      const mean = total / 3;
      if (mean <= 0) continue;

      const variance = monthly.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 3;
      const coefficientOfVariation = Math.sqrt(variance) / mean;

      // cv baixo = valor quase identico todo mes = provavel gasto fixo,
      // nao "variavel" — nao serve pra sugestao de corte.
      if (coefficientOfVariation <= 0.2) continue;

      if (!topVariableCategory || total > topVariableCategory.total) {
        topVariableCategory = { name, total };
      }
    }

    return {
      topVariableCategory,
      avgMonthlySurplus: transactions.length > 0 ? avgMonthlySurplus : null,
    };
  }

  private buildSimulations(
    summary: DashboardSummary,
    question: string,
    spendingAnalysis: SpendingAnalysis,
  ) {
    const simulations: AssistantSimulation[] = [];
    const currency = this.currency(summary);
    const forecastBalance = Number(summary.forecast.predictedBalance ?? 0);
    const monthlyExpenses = Number(summary.finances.monthlyExpenses ?? 0);
    const topGoal = summary.goals[0];
    const debtAmount = this.extractQuestionAmount(question);

    if (spendingAnalysis.topVariableCategory) {
      const { name, total } = spendingAnalysis.topVariableCategory;
      const delta = Math.round(total * 0.1);
      simulations.push({
        id: "expense-trim-category",
        title: `Corte em ${name}`,
        summary: `"${name}" foi sua categoria de maior gasto variável nos últimos 3 meses (${this.formatCurrency(
          total,
          currency,
        )} no total). Enxugando 10% dela, a projeção vai para ${this.formatCurrency(
          forecastBalance + delta,
          currency,
        )}.`,
        monthlyDelta: delta,
        projectedBalance: forecastBalance + delta,
        confidence: "medium",
        assumptions: [
          "Baseado no histórico real de transações da categoria nos últimos 3 meses, não numa média genérica.",
          "Categoria considerada variável por oscilar de mês a mês — gastos fixos como aluguel ficam de fora.",
        ],
      });
    } else if (monthlyExpenses > 0) {
      const delta = Math.round(monthlyExpenses * 0.1);
      simulations.push({
        id: "expense-trim-10",
        title: "Ajuste leve de gastos",
        summary: `Se você enxugar perto de 10% das saídas variáveis do mês, a projeção vai para ${this.formatCurrency(
          forecastBalance + delta,
          currency,
        )}.`,
        monthlyDelta: delta,
        projectedBalance: forecastBalance + delta,
        confidence: "medium",
        assumptions: [
          "Estimativa baseada nas despesas registradas neste mês.",
          "Sem categorias com histórico suficiente nos últimos 3 meses pra apontar uma específica.",
        ],
      });
    }

    if (debtAmount && spendingAnalysis.avgMonthlySurplus && spendingAnalysis.avgMonthlySurplus > 0) {
      const surplus = spendingAnalysis.avgMonthlySurplus;
      const months = Math.min(Math.max(Math.ceil(debtAmount / surplus), 1), 60);
      const monthlyParcel = Math.round(debtAmount / months);
      simulations.push({
        id: "debt-personalized",
        title: `Parcelamento em ${months} ${months === 1 ? "mês" : "meses"}`,
        summary: `Para uma dívida aproximada de ${this.formatCurrency(
          debtAmount,
          currency,
        )}, usando sua sobra média real dos últimos 3 meses (${this.formatCurrency(
          surplus,
          currency,
        )}/mês), uma quitação em ${months} ${months === 1 ? "mês" : "meses"} sugere parcela perto de ${this.formatCurrency(
          monthlyParcel,
          currency,
        )}.`,
        monthlyDelta: -monthlyParcel,
        projectedBalance: forecastBalance - monthlyParcel,
        confidence: "medium",
        assumptions: [
          "Baseado na sobra média real (entradas menos saídas) dos últimos 3 meses, não num prazo fixo de 8 meses.",
          "Cálculo simplificado, sem juros, multas ou descontos de negociação.",
        ],
      });
    } else if (debtAmount) {
      const monthlyParcel = Math.round(debtAmount / 8);
      simulations.push({
        id: "debt-8x",
        title: "Parcelamento linear em 8 meses",
        summary: `Para uma dívida aproximada de ${this.formatCurrency(
          debtAmount,
          currency,
        )}, uma divisão linear em 8 meses sugere parcela perto de ${this.formatCurrency(
          monthlyParcel,
          currency,
        )}.`,
        monthlyDelta: -monthlyParcel,
        projectedBalance: forecastBalance - monthlyParcel,
        confidence: "low",
        assumptions: [
          "Sem sobra mensal positiva nos últimos 3 meses pra personalizar o prazo — usando 8 meses como referência neutra.",
          "Cálculo simplificado, sem juros, multas ou descontos de negociação.",
        ],
      });
    }

    if (topGoal) {
      const remaining = Math.max(topGoal.targetAmount - topGoal.currentAmount, 0);
      const contribution = Math.min(Math.max(Math.round(forecastBalance * 0.15), 0), remaining);

      if (contribution > 0) {
        simulations.push({
          id: "goal-contribution",
          title: `Aporte tático em ${topGoal.title}`,
          summary: `Separando ${this.formatCurrency(
            contribution,
            currency,
          )} para ${topGoal.title}, a projeção de caixa cairia para ${this.formatCurrency(
            forecastBalance - contribution,
            currency,
          )}, mas a meta ganharia tração imediata.`,
          monthlyDelta: -contribution,
          projectedBalance: forecastBalance - contribution,
          confidence: forecastBalance > contribution ? "medium" : "low",
          assumptions: [
            "Considera uso de uma parte do saldo previsto, não do saldo histórico inteiro.",
            "Não substitui revisão das prioridades básicas do mês.",
          ],
        });
      }
    }

    return simulations.slice(0, 3);
  }

  private buildContinuity(
    summary: DashboardSummary,
    question: string,
    reply: AssistantReply,
    history: AskAssistantHistoryItemDto[],
    originModule: AssistantModule,
  ): AssistantContinuity {
    const recentHistory = history.slice(0, 2);
    const memorySummary = recentHistory.length
      ? `Nas últimas ${recentHistory.length} conversa(s), você passou por ${recentHistory
          .map((item) => this.sanitizeExternalText(item.question).slice(0, 70))
          .join(" e ")}.`
      : null;
    const followUpPrompt =
      reply.continuity.followUpPrompt ||
      this.defaultFollowUpPrompt(summary, reply.focusArea || "Panorama");

    return {
      historyCount: recentHistory.length,
      memorySummary,
      nextQuestion: this.defaultNextQuestion(summary, question, reply.focusArea || "Panorama"),
      followUpPrompt,
      originModule,
    };
  }

  private buildExplainability(
    summary: DashboardSummary,
    question: string,
    reply: AssistantReply,
    continuity: AssistantContinuity,
  ): AssistantExplainability {
    const currency = this.currency(summary);
    const evidence = [
      `Saldo atual observado: ${this.formatCurrency(summary.finances.balance, currency)}.`,
      `Saldo previsto no horizonte atual: ${this.formatCurrency(
        Number(summary.forecast.predictedBalance ?? 0),
        currency,
      )}.`,
      summary.tasks.items[0]
        ? `Tarefa concreta em foco: ${summary.tasks.items[0].title}.`
        : null,
      summary.finances.recentTransactions[0]
        ? `Movimentação recente relevante: ${summary.finances.recentTransactions[0].description}.`
        : null,
      summary.goals[0]
        ? `Meta ativa usada como contexto: ${summary.goals[0].title}.`
        : null,
      continuity.memorySummary,
    ];
    const reasoning =
      reply.explainability.reasoning.length > 0
        ? reply.explainability.reasoning
        : this.fallbackReasoning(summary, question, reply.focusArea || "Panorama");

    return {
      reasoning: reasoning.slice(0, 4),
      evidence: this.readNonEmptyList(evidence, 5),
      confidenceReason:
        reply.explainability.confidenceReason ||
        this.fallbackConfidenceReason(summary, reply.confidence, question),
    };
  }

  private buildLifeContextSummary(summary: DashboardSummary) {
    const criticalCount = summary.insights.filter(
      (insight) => insight.severity === "CRITICAL",
    ).length;
    const nextGoal = summary.goals[0];
    const currency = this.currency(summary);
    const firstName = this.extractFirstName(summary.user.name);

    return [
      `${firstName} tem ${summary.tasks.todayCount} tarefa(s) para hoje e ${summary.tasks.overdueCount} atrasada(s).`,
      criticalCount
        ? `${criticalCount} alerta(s) critico(s) ja foram detectados pelo motor de insights.`
        : "Nao ha alerta critico aberto neste momento.",
      `Saldo atual em ${this.formatCurrency(summary.finances.balance, currency)} com previsao de ${this.formatCurrency(Number(summary.forecast.predictedBalance ?? 0), currency)} e risco ${String(summary.forecast.riskLevel).toLowerCase()}.`,
      nextGoal
        ? `Meta em foco: ${this.sanitizeExternalText(nextGoal.title)}, ${this.goalProgress(nextGoal)}% concluida.`
        : "Nenhuma meta ativa precisa de destaque imediato agora.",
    ].join(" ");
  }

  private buildApplicationPromptContext(
    summary: DashboardSummary,
    intent: "today_overview" | "priorities" | "finance_overview" | "general",
  ) {
    const currency = this.currency(summary);
    const criticalInsights = summary.insights.filter(
      (insight) => insight.severity === "CRITICAL",
    );
    const warningInsights = summary.insights.filter(
      (insight) => insight.severity === "WARNING",
    );
    const openTasks = summary.tasks.items.slice(0, 5);
    const recentTransactions = summary.finances.recentTransactions.slice(0, 5);
    const goals = summary.goals.slice(0, 4);
    const reminders = summary.reminders.slice(0, 4);
    const notifications = summary.notifications.slice(0, 4);
    const firstName = this.extractFirstName(summary.user.name);

    return [
      `Intenção principal da resposta: ${intent}.`,
      `Usuario em analise: ${firstName}.`,
      this.describeUserProfile(summary.user),
      `Leitura do dia: ${summary.tasks.todayCount} tarefa(s) para hoje, ${summary.tasks.overdueCount} atrasada(s), ${criticalInsights.length} insight(s) critico(s) e ${warningInsights.length} insight(s) de atencao.`,
      `Leitura financeira: saldo atual ${this.formatCurrency(summary.finances.balance, currency)}, entradas no mes ${this.formatCurrency(summary.finances.monthlyIncome, currency)}, saidas no mes ${this.formatCurrency(summary.finances.monthlyExpenses, currency)}, previsao ${this.formatCurrency(Number(summary.forecast.predictedBalance ?? 0), currency)} e risco ${String(summary.forecast.riskLevel).toLowerCase()}.`,
      this.describeDecisionAnchors(openTasks, recentTransactions, goals, summary.insights, currency),
      this.describeTasks(openTasks, currency),
      this.describeTransactions(recentTransactions, currency),
      this.describeGoals(goals),
      this.describeInsights(summary.insights),
      this.describeReminders(reminders),
      this.describeNotifications(notifications),
    ]
      .filter(Boolean)
      .join("\n");
  }

  private buildPulseSummary(
    summary: DashboardSummary,
    signals: AssistantProactiveSignal[],
  ) {
    if (signals[0]) {
      return signals[0].message;
    }

    return `Seu momento está estável: ${summary.tasks.todayCount} tarefa(s) para hoje, ${summary.goals.length} meta(s) ativa(s) e previsão em ${this.formatCurrency(
      Number(summary.forecast.predictedBalance ?? 0),
      this.currency(summary),
    )}.`;
  }

  private buildPulseQuestion(summary: DashboardSummary) {
    if (summary.forecast.riskLevel === "HIGH") {
      return "O que eu preciso proteger primeiro no meu caixa esta semana?";
    }

    if (summary.tasks.overdueCount > 0) {
      return "Qual pendência atrasada eu devo limpar antes do resto?";
    }

    if (summary.goals.length > 0) {
      return `Como acelerar a meta ${summary.goals[0].title} sem bagunçar o mês?`;
    }

    return "Onde vale colocar energia agora para ganhar mais tração?";
  }

  private createAction(
    kind: AssistantActionKind,
    input: Omit<AssistantAction, "id" | "kind" | "route" | "payload"> & {
      route?: string | null;
      payload?: Record<string, unknown> | null;
    },
  ): AssistantAction {
    return {
      id: `${kind}-${this.normalizeForMatch(input.title).replace(/\s+/g, "-").slice(0, 40) || randomUUID()}`,
      kind,
      route: input.route ?? null,
      payload: input.payload ?? null,
      ...input,
    };
  }

  private toCreateTaskDto(
    title: string | undefined,
    payload: Record<string, unknown>,
  ): CreateTaskDto {
    return {
      title: String(payload.title || title || "Nova tarefa do Selah").trim(),
      description: this.optionalString(payload.description),
      dueDate: this.optionalString(payload.dueDate),
      priority: this.optionalTaskPriority(payload.priority),
      categoryId: this.optionalString(payload.categoryId),
      hasFinancialImpact: Boolean(payload.hasFinancialImpact),
      estimatedAmount: this.optionalNumber(payload.estimatedAmount) ?? undefined,
      status: undefined,
      isRecurring: false,
      recurrenceRule: undefined,
      linkedGoalId: this.optionalString(payload.linkedGoalId),
      subtasks: [],
    };
  }

  private toCreateGoalDto(
    title: string | undefined,
    payload: Record<string, unknown>,
  ): CreateGoalDto {
    const targetAmount = Number(payload.targetAmount);

    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      throw new BadRequestException("A meta sugerida pelo assistente nao tem valor-alvo valido.");
    }

    return {
      title: String(payload.title || title || "Nova meta do Selah").trim(),
      description: this.optionalString(payload.description),
      targetAmount,
      currentAmount: this.optionalNumber(payload.currentAmount) ?? 0,
      targetDate: this.optionalString(payload.targetDate),
      status: undefined,
    };
  }

  private toCreateReminderDto(
    title: string | undefined,
    payload: Record<string, unknown>,
  ): CreateReminderDto {
    const remindAt = this.optionalString(payload.remindAt);

    if (!remindAt) {
      throw new BadRequestException("A acao do assistente precisa de uma data para o lembrete.");
    }

    return {
      title: String(payload.title || title || "Novo lembrete do Selah").trim(),
      remindAt,
      taskId: this.optionalString(payload.taskId),
      transactionId: this.optionalString(payload.transactionId),
      goalId: this.optionalString(payload.goalId),
    };
  }

  private nextReminderDate(offsetDays: number, hour: number) {
    const next = new Date();
    next.setHours(hour, 0, 0, 0);
    next.setDate(next.getDate() + offsetDays);
    return next.toISOString();
  }

  private nextDateInputValue(offsetDays: number) {
    const next = new Date();
    next.setHours(12, 0, 0, 0);
    next.setDate(next.getDate() + offsetDays);
    return next.toISOString().slice(0, 10);
  }

  private extractQuestionAmount(question: string) {
    const matches = String(question || "")
      .match(/(?:r\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\s*(?:mil|k)?/gi);

    const first = matches?.[0];
    if (!first) {
      return null;
    }

    const normalized = first.toLowerCase().replace(/\s+/g, "");
    const multiplier = normalized.includes("mil") || normalized.includes("k") ? 1000 : 1;
    const numeric = normalized
      .replace(/r\$/g, "")
      .replace(/mil|k/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const amount = Number(numeric);

    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    return amount * multiplier;
  }

  private defaultFollowUpPrompt(summary: DashboardSummary, focusArea: string) {
    if (focusArea.toLowerCase().includes("financ")) {
      return "Me ajuda a transformar isso num plano de 7 dias.";
    }

    if (summary.tasks.overdueCount > 0) {
      return "Monta uma ordem prática para eu limpar essas pendências.";
    }

    if (summary.goals[0]) {
      return `Monta um próximo passo simples para a meta ${summary.goals[0].title}.`;
    }

    return "Traduz isso em um plano curto e executável.";
  }

  private defaultNextQuestion(
    summary: DashboardSummary,
    question: string,
    focusArea: string,
  ) {
    const normalizedQuestion = this.normalizeForMatch(question);

    if (normalizedQuestion.includes("divid") || focusArea.toLowerCase().includes("financ")) {
      return "Qual corte ou negociação me dá mais fôlego nos próximos 30 dias?";
    }

    if (summary.tasks.items[0]) {
      return `Como encaixar ${summary.tasks.items[0].title} sem travar o resto do dia?`;
    }

    if (summary.goals[0]) {
      return `Qual o menor aporte útil para a meta ${summary.goals[0].title}?`;
    }

    return "Qual é o próximo passo com melhor impacto agora?";
  }

  private fallbackReasoning(
    summary: DashboardSummary,
    question: string,
    focusArea: string,
  ) {
    const reasoning = [];

    reasoning.push(
      `A resposta parte da sua pergunta atual e do foco ${focusArea.toLowerCase()} detectado no LUMEN.`,
    );
    reasoning.push(
      `O Selah cruzou tarefas do dia, fluxo financeiro e metas para evitar conselho genérico.`,
    );

    if (summary.forecast.riskLevel === "HIGH") {
      reasoning.push(
        "Como a previsão está em risco alto, o plano puxa contenção e priorização antes de expansão.",
      );
    }

    if (this.matchQuestionTargets(summary, question).length > 0) {
      reasoning.push(
        "Itens citados explicitamente na sua pergunta ganharam prioridade sobre o panorama amplo.",
      );
    }

    return reasoning.slice(0, 4);
  }

  private fallbackConfidenceReason(
    summary: DashboardSummary,
    confidence: AssistantConfidence,
    question: string,
  ) {
    const anchors = this.matchQuestionTargets(summary, question).length;

    if (confidence === "high") {
      return `A confiança está alta porque havia dados concretos suficientes no app${anchors ? ` e ${anchors} alvo(s) citado(s) por você` : ""}.`;
    }

    if (confidence === "low") {
      return "A confiança ficou mais baixa porque faltam detalhes críticos para simular ou recomendar algo mais preciso.";
    }

    return "A confiança ficou média porque o cenário já tem sinais úteis, mas ainda sem todos os detalhes operacionais ou contratuais.";
  }

  private currency(summary: DashboardSummary) {
    return summary.user.preferredCurrency || "BRL";
  }

  private goalProgress(goal: { currentAmount: number; targetAmount: number }) {
    const target = Number(goal.targetAmount || 0);
    const current = Number(goal.currentAmount || 0);

    if (target <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
  }

  private formatCurrency(amount: number, currency: string) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
  }

  private formatDate(value: Date | string | null | undefined) {
    if (!value) {
      return undefined;
    }

    return new Date(value).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    });
  }

  private formatDateTime(value: Date | string | null | undefined) {
    if (!value) {
      return "horario nao informado";
    }

    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private formatEnumLabel(value: string | null | undefined) {
    return String(value || "")
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  private readStringList(value: unknown, maxItems: number) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, maxItems);
  }

  private readNonEmptyList(
    items: Array<string | null | undefined>,
    maxItems: number,
  ) {
    return items.filter((item): item is string => Boolean(item)).slice(0, maxItems);
  }

  private optionalString(value: unknown) {
    const normalized = String(value || "").trim();
    return normalized || undefined;
  }

  private optionalNumber(value: unknown) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
  }

  private optionalTaskPriority(value: unknown) {
    const normalized = String(value || "").trim().toUpperCase();

    if (
      normalized === "LOW" ||
      normalized === "MEDIUM" ||
      normalized === "HIGH" ||
      normalized === "CRITICAL"
    ) {
      return normalized as CreateTaskDto["priority"];
    }

    return undefined;
  }

  private normalizeConfidence(value: unknown): AssistantConfidence {
    const normalized = String(value || "")
      .trim()
      .toLowerCase() as AssistantConfidence;

    if (
      normalized === "low" ||
      normalized === "medium" ||
      normalized === "high"
    ) {
      return normalized;
    }

    return "medium";
  }

  private detectIntent(question: string) {
    const normalizedQuestion = question.toLowerCase();

    if (normalizedQuestion.includes("prioriz")) {
      return "priorities" as const;
    }

    if (
      normalizedQuestion.includes("finance") ||
      normalizedQuestion.includes("saldo") ||
      normalizedQuestion.includes("dinheiro") ||
      normalizedQuestion.includes("divid") ||
      normalizedQuestion.includes("dívida") ||
      normalizedQuestion.includes("quitar") ||
      normalizedQuestion.includes("renegoci") ||
      normalizedQuestion.includes("juros") ||
      normalizedQuestion.includes("parcela") ||
      normalizedQuestion.includes("cartão") ||
      normalizedQuestion.includes("cartao") ||
      normalizedQuestion.includes("emprést") ||
      normalizedQuestion.includes("emprest") ||
      normalizedQuestion.includes("despesa") ||
      normalizedQuestion.includes("gasto") ||
      normalizedQuestion.includes("orçamento") ||
      normalizedQuestion.includes("orcamento")
    ) {
      return "finance_overview" as const;
    }

    if (
      normalizedQuestion.includes("como estou hoje") ||
      normalizedQuestion.includes("meu dia") ||
      normalizedQuestion.includes("hoje")
    ) {
      return "today_overview" as const;
    }

    return "general" as const;
  }

  private resolveFocusArea(
    intent: "today_overview" | "priorities" | "finance_overview" | "general",
  ) {
    if (intent === "priorities") {
      return "Prioridades";
    }

    if (intent === "finance_overview") {
      return "Financeiro";
    }

    return "Panorama";
  }

  private buildQuestionContextSummary(
    summary: DashboardSummary,
    question: string,
  ) {
    const normalizedQuestion = this.normalizeForMatch(question);
    const matchedTargets = this.matchQuestionTargets(summary, question);
    const signals = [
      normalizedQuestion.includes("por que") ? "causa" : null,
      normalizedQuestion.includes("como") ? "orientacao pratica" : null,
      normalizedQuestion.includes("devo") || normalizedQuestion.includes("prioriz")
        ? "decisao de prioridade"
        : null,
      normalizedQuestion.includes("risco") ||
      normalizedQuestion.includes("saldo") ||
      normalizedQuestion.includes("gasto") ||
      normalizedQuestion.includes("dinheiro") ||
      normalizedQuestion.includes("divid") ||
      normalizedQuestion.includes("dívida") ||
      normalizedQuestion.includes("quitar") ||
      normalizedQuestion.includes("renegoci") ||
      normalizedQuestion.includes("juros") ||
      normalizedQuestion.includes("parcela")
        ? "leitura financeira"
        : null,
      normalizedQuestion.includes("rotina") ||
      normalizedQuestion.includes("vida pessoal") ||
      normalizedQuestion.includes("foco") ||
      normalizedQuestion.includes("cansa") ||
      normalizedQuestion.includes("procrast")
        ? "organizacao de vida pessoal"
        : null,
      normalizedQuestion.includes("meta") ? "progresso de meta" : null,
      normalizedQuestion.includes("tarefa") ? "execucao de tarefa" : null,
    ].filter(Boolean);

    if (matchedTargets.length) {
      return `O usuário citou explicitamente ${matchedTargets.join(", ")}. A resposta deve começar por esse(s) item(ns) e só depois conectar panorama mais amplo se isso ajudar a responder a pergunta. Sinais da pergunta: ${signals.join(", ") || "leitura contextual"}. Formato esperado: resposta mais detalhada, em 2 ou 3 blocos curtos, cobrindo resposta direta, contexto e próximos passos.`;
    }

    return `A resposta deve priorizar o que a pergunta pede de forma direta, sem cair em panorama padrão quando não for necessário. Sinais da pergunta: ${signals.join(", ") || "leitura contextual"}. Formato esperado: resposta mais detalhada, em 2 ou 3 blocos curtos, cobrindo resposta direta, contexto e próximos passos.`;
  }

  private matchQuestionTargets(summary: DashboardSummary, question: string) {
    const normalizedQuestion = this.normalizeForMatch(question);
    const candidates = [
      ...summary.tasks.items.map((task) => task.title),
      ...summary.finances.recentTransactions.map(
        (transaction) => transaction.description,
      ),
      ...summary.goals.map((goal) => goal.title),
      ...summary.insights.map((insight) => this.firstMeaningfulFragment(insight.message)),
    ]
      .map((value) => String(value || "").trim())
      .filter((value) => value.length >= 4);

    const matches = candidates.filter((candidate) => {
      const normalizedCandidate = this.normalizeForMatch(candidate);

      if (normalizedQuestion.includes(normalizedCandidate)) {
        return true;
      }

      const significantTokens = normalizedCandidate
        .split(" ")
        .filter((token) => token.length >= 4);
      const tokenMatches = significantTokens.filter((token) =>
        normalizedQuestion.includes(token),
      ).length;

      return tokenMatches >= Math.min(2, significantTokens.length);
    });

    return Array.from(new Set(matches)).slice(0, 5);
  }

  private ensureHighlights(items: Array<string | null | undefined>) {
    const normalized = items
      .filter((item): item is string => Boolean(item))
      .slice(0, ASSISTANT_REPLY_LIST_LIMIT);

    if (normalized.length) {
      return normalized;
    }

    return ["Nenhum alerta critico ativo neste momento."];
  }

  private ensureActions(items: Array<string | null | undefined>) {
    const normalized = items
      .filter((item): item is string => Boolean(item))
      .slice(0, ASSISTANT_REPLY_LIST_LIMIT);

    if (normalized.length >= 2) {
      return normalized;
    }

    return [
      ...normalized,
      "Revisar o panorama do dia antes de abrir novas demandas.",
    ].slice(0, ASSISTANT_REPLY_LIST_LIMIT);
  }

  private describeTasks(
    tasks: DashboardSummary["tasks"]["items"],
    currency: string,
  ) {
    if (!tasks.length) {
      return "Tarefas abertas relevantes: nenhuma tarefa prioritaria aberta foi enviada.";
    }

    return `Tarefas abertas relevantes:\n- ${tasks
      .map((task) => {
        const dueDate = task.dueDate
          ? `vence ${this.formatDate(task.dueDate)}`
          : "sem prazo definido";
        const priority = task.priority
          ? `prioridade ${this.formatEnumLabel(task.priority)}`
          : "prioridade nao informada";
        const category = task.category?.name
          ? `categoria ${this.sanitizeExternalText(task.category.name)}`
          : "sem categoria";
        const financialImpact =
          task.hasFinancialImpact &&
          task.estimatedAmount !== null &&
          task.estimatedAmount !== undefined
            ? `impacto estimado ${this.formatCurrency(Number(task.estimatedAmount), currency)}`
            : task.hasFinancialImpact
              ? "com impacto financeiro"
              : "sem impacto financeiro direto";

        return `${this.sanitizeExternalText(task.title)} | ${priority} | ${dueDate} | ${category} | ${financialImpact}`;
      })
      .join("\n- ")}`;
  }

  private describeTransactions(
    transactions: DashboardSummary["finances"]["recentTransactions"],
    currency: string,
  ) {
    if (!transactions.length) {
      return "Movimentacoes recentes: nenhuma transacao recente enviada.";
    }

    return `Movimentacoes recentes:\n- ${transactions
      .map((transaction) => {
        const type = this.formatEnumLabel(transaction.type);
        const category = transaction.category?.name
          ? this.sanitizeExternalText(transaction.category.name)
          : "sem categoria";
        return `${this.sanitizeExternalText(transaction.description)} | ${type} | ${this.formatCurrency(Number(transaction.amount), currency)} | ${this.formatDate(transaction.date)} | ${category}`;
      })
      .join("\n- ")}`;
  }

  /**
   * Perfil pessoal declarado no cadastro/configuracoes — permite que o
   * Selah personalize conselhos por faixa etaria, profissao e o objetivo
   * que o usuario disse ter ao entrar no LUMEN, em vez de falar generico.
   */
  private describeUserProfile(user: DashboardSummary["user"]) {
    const parts: string[] = [];

    const age = this.calculateAge(user.birthDate);
    if (age !== null) {
      parts.push(`${age} anos`);
    }

    if (user.occupation) {
      parts.push(this.sanitizeExternalText(user.occupation));
    }

    if (parts.length === 0 && !user.primaryGoal) {
      return "";
    }

    const profileLine = parts.length
      ? `Perfil pessoal: ${parts.join(", ")}.`
      : "";
    const goalLine = user.primaryGoal
      ? `Objetivo principal declarado no cadastro: "${this.sanitizeExternalText(user.primaryGoal)}".`
      : "";

    return [profileLine, goalLine].filter(Boolean).join("\n");
  }

  /**
   * birthDate e um campo so-de-data, gravado a meia-noite UTC — ler com
   * getFullYear()/getMonth()/getDate() (fuso local do processo) pode voltar
   * um dia quando o servidor roda a oeste de UTC (ex: America/Sao_Paulo faz
   * 01/01T00:00Z virar 31/12 as 21h local, subtraindo 1 ano errado da
   * idade). Os metodos UTC leem o dia civil exatamente como foi gravado.
   */
  private calculateAge(birthDate: Date | string | null | undefined) {
    if (!birthDate) return null;

    const birth = new Date(birthDate);
    if (Number.isNaN(birth.getTime())) return null;

    const now = new Date();
    let age = now.getFullYear() - birth.getUTCFullYear();
    const hasHadBirthdayThisYear =
      now.getMonth() > birth.getUTCMonth() ||
      (now.getMonth() === birth.getUTCMonth() && now.getDate() >= birth.getUTCDate());

    if (!hasHadBirthdayThisYear) {
      age -= 1;
    }

    return age >= 0 ? age : null;
  }

  private describeGoals(goals: DashboardSummary["goals"]) {
    if (!goals.length) {
      return "Metas em andamento: nenhuma meta ativa foi enviada.";
    }

    return `Metas em andamento:\n- ${goals
      .map((goal) => {
        const targetDate = goal.targetDate
          ? `data alvo ${this.formatDate(goal.targetDate)}`
          : "sem data alvo";
        return `${this.sanitizeExternalText(goal.title)} | status ${this.formatEnumLabel(goal.status)} | progresso ${this.goalProgress(goal)}% | ${targetDate}`;
      })
      .join("\n- ")}`;
  }

  private describeInsights(insights: DashboardSummary["insights"]) {
    if (!insights.length) {
      return "Insights atuais: nenhum insight ativo foi enviado.";
    }

    return `Insights atuais:\n- ${insights
      .map((insight) => {
        const persona = insight.metadata?.persona?.name;
        const voice = persona
          ? `${persona} (${this.formatEnumLabel(insight.type)})`
          : this.formatEnumLabel(insight.type);

        return `${this.formatEnumLabel(insight.severity)} | ${voice} | ${this.sanitizeExternalText(insight.message)}`;
      })
      .join("\n- ")}`;
  }

  private describeDecisionAnchors(
    tasks: DashboardSummary["tasks"]["items"],
    transactions: DashboardSummary["finances"]["recentTransactions"],
    goals: DashboardSummary["goals"],
    insights: DashboardSummary["insights"],
    currency: string,
  ) {
    const primaryTask = tasks[0];
    const financialTask = tasks.find((task) => task.hasFinancialImpact);
    const latestExpense = transactions.find(
      (transaction) => transaction.type === "EXPENSE",
    );
    const latestIncome = transactions.find(
      (transaction) => transaction.type === "INCOME",
    );
    const primaryGoal = goals[0];
    const priorityInsight =
      insights.find((insight) => insight.severity === "CRITICAL") ??
      insights.find((insight) => insight.severity === "WARNING") ??
      insights[0];

    const anchors = [
      primaryTask
        ? `Tarefa mais prioritária para citar pelo nome: ${this.sanitizeExternalText(primaryTask.title)}${primaryTask.dueDate ? `, vence ${this.formatDate(primaryTask.dueDate)}` : ""}${primaryTask.priority ? `, prioridade ${this.formatEnumLabel(primaryTask.priority)}` : ""}.`
        : null,
      financialTask
        ? `Tarefa com impacto financeiro direto: ${this.sanitizeExternalText(financialTask.title)}${financialTask.estimatedAmount ? `, impacto estimado ${this.formatCurrency(Number(financialTask.estimatedAmount), currency)}` : ""}.`
        : null,
      latestExpense
        ? `Saída concreta para mencionar se fizer sentido: ${this.sanitizeExternalText(latestExpense.description)}, ${this.formatCurrency(Number(latestExpense.amount), currency)} em ${this.formatDate(latestExpense.date)}.`
        : null,
      latestIncome
        ? `Entrada concreta disponível: ${this.sanitizeExternalText(latestIncome.description)}, ${this.formatCurrency(Number(latestIncome.amount), currency)} em ${this.formatDate(latestIncome.date)}.`
        : null,
      primaryGoal
        ? `Meta concreta para conectar na resposta: ${this.sanitizeExternalText(primaryGoal.title)}, ${this.goalProgress(primaryGoal)}% concluida.`
        : null,
      priorityInsight
        ? `Insight mais acionável no momento: ${this.sanitizeExternalText(priorityInsight.message)}.`
        : null,
    ].filter(Boolean);

    if (!anchors.length) {
      return "Âncoras concretas: nenhum item nomeado relevante foi enviado.";
    }

    return `Âncoras concretas preferenciais:\n- ${anchors.join("\n- ")}`;
  }

  private describeReminders(reminders: DashboardSummary["reminders"]) {
    if (!reminders.length) {
      return "Lembretes proximos: nenhum lembrete agendado enviado.";
    }

    return `Lembretes proximos:\n- ${reminders
      .map(
        (reminder) =>
          `${this.sanitizeExternalText(reminder.title)} em ${this.formatDateTime(reminder.remindAt)}`,
      )
      .join("\n- ")}`;
  }

  private describeNotifications(
    notifications: DashboardSummary["notifications"],
  ) {
    if (!notifications.length) {
      return "Notificacoes abertas: nenhuma notificacao aberta enviada.";
    }

    return `Notificacoes abertas:\n- ${notifications
      .map(
        (notification) =>
          `${this.sanitizeExternalText(notification.title)}: ${this.sanitizeExternalText(notification.message)}`,
      )
      .join("\n- ")}`;
  }

  private firstMeaningfulFragment(message: string) {
    return String(message || "")
      .split(/[.!?]/)[0]
      .trim();
  }

  private normalizeForMatch(value: string) {
    return String(value || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9%$ ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private async loadPrivacySettings(
    userId: string,
  ): Promise<AssistantPrivacySettings> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        privacyNoticeAcceptedAt: true,
        aiAssistantEnabled: true,
        aiAssistantConsentAt: true,
      },
    });

    return {
      privacyNoticeAcceptedAt: user.privacyNoticeAcceptedAt,
      aiAssistantEnabled: user.aiAssistantEnabled,
      aiAssistantConsentAt: user.aiAssistantConsentAt,
    };
  }

  private resolveLocalDisclaimer(reason: SelahAttemptReason) {
    if (reason === "privacy_notice_missing") {
      return "Revise e aceite o aviso de privacidade nas configuracoes para liberar o uso de IA externa.";
    }

    if (reason === "ai_consent_missing") {
      return "O uso do SelahIA esta desligado nas configuracoes de privacidade. Resposta gerada pelo modo local do LUMEN.";
    }

    if (reason === "integration_disabled" || reason === "selah_unavailable") {
      return "SelahIA indisponivel no momento. Resposta gerada pelo modo local do LUMEN.";
    }

    return null;
  }

  private extractFirstName(name: string) {
    return (
      String(name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)[0] || "Voce"
    );
  }

  private sanitizeExternalText(text: string) {
    return String(text || "")
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        "[email removido]",
      )
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf removido]")
      .replace(
        /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}\b/g,
        "[telefone removido]",
      )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  private readTimeout() {
    const value = Number(this.readEnv("SELAH_TIMEOUT_MS") || 3500);
    return Number.isFinite(value) && value > 0 ? value : 3500;
  }

  private readBooleanEnv(key: string) {
    return (
      String(this.configService.get<string>(key) || "")
        .trim()
        .toLowerCase() === "true"
    );
  }

  private readEnv(key: string) {
    return String(this.configService.get<string>(key) || "").trim();
  }

  private postJson(
    rawUrl: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ) {
    return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const url = new URL(rawUrl);
      const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = requester(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers,
          timeout: timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          response.on("end", () => {
            resolve({
              statusCode: Number(response.statusCode || 0),
              body: Buffer.concat(chunks).toString("utf-8"),
            });
          });
        },
      );

      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy(new Error("Timeout ao consultar o SelahIA."));
      });
      request.write(body);
      request.end();
    });
  }
}
