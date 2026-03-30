import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { DashboardService } from "../dashboard/dashboard.service";
import { PrismaService } from "../prisma/prisma.service";

type AssistantConfidence = "low" | "medium" | "high";

type DashboardSummary = {
  user: {
    name: string;
    preferredCurrency: string;
    monthlyIncome: number;
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

type AssistantReply = {
  answer: string;
  highlights: string[];
  suggestedActions: string[];
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

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  // Runtime bridge between LUMEN and SelahIA with safe local fallback.

  constructor(
    private readonly dashboardService: DashboardService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async ask(userId: string, question: string): Promise<AssistantReply> {
    const [summary, privacySettings] = await Promise.all([
      this.dashboardService.getSummary(userId) as Promise<DashboardSummary>,
      this.loadPrivacySettings(userId),
    ]);
    const selahResult = await this.askSelah(summary, privacySettings, question);

    if (selahResult.reply) {
      return selahResult.reply;
    }

    return this.buildLocalReply(
      summary,
      question,
      this.resolveLocalDisclaimer(selahResult.reason),
    );
  }

  private async askSelah(
    summary: DashboardSummary,
    privacySettings: AssistantPrivacySettings,
    question: string,
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
    const body = JSON.stringify(this.buildSelahPayload(summary, question));

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

  private buildSelahPayload(summary: DashboardSummary, question: string) {
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
      highlights: this.readStringList(payload.highlights, 4),
      suggestedActions: this.readStringList(payload.suggestedActions, 4),
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
      source: "lumen_fallback",
      provider: "LUMEN Local",
      focusArea,
      confidence: "medium",
      disclaimer,
      generatedAt: new Date().toISOString(),
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
      normalizedQuestion.includes("dinheiro")
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
      normalizedQuestion.includes("dinheiro")
        ? "leitura financeira"
        : null,
      normalizedQuestion.includes("meta") ? "progresso de meta" : null,
      normalizedQuestion.includes("tarefa") ? "execucao de tarefa" : null,
    ].filter(Boolean);

    if (matchedTargets.length) {
      return `O usuário citou explicitamente ${matchedTargets.join(", ")}. A resposta deve começar por esse(s) item(ns) e só depois conectar panorama mais amplo se isso ajudar a responder a pergunta. Sinais da pergunta: ${signals.join(", ") || "leitura contextual"}.`;
    }

    return `A resposta deve priorizar o que a pergunta pede de forma direta, sem cair em panorama padrão quando não for necessário. Sinais da pergunta: ${signals.join(", ") || "leitura contextual"}.`;
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
      .slice(0, 4);

    if (normalized.length) {
      return normalized;
    }

    return ["Nenhum alerta critico ativo neste momento."];
  }

  private ensureActions(items: Array<string | null | undefined>) {
    const normalized = items
      .filter((item): item is string => Boolean(item))
      .slice(0, 4);

    if (normalized.length >= 2) {
      return normalized;
    }

    return [
      ...normalized,
      "Revisar o panorama do dia antes de abrir novas demandas.",
    ].slice(0, 4);
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
      .map(
        (insight) =>
          `${this.formatEnumLabel(insight.severity)} | ${this.formatEnumLabel(insight.type)} | ${this.sanitizeExternalText(insight.message)}`,
      )
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
