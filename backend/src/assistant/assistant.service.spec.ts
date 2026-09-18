import { AssistantService } from "./assistant.service";

describe("AssistantService", () => {
  const buildDashboardService = (overrides: Record<string, unknown> = {}) =>
    ({
      getSummary: jest.fn().mockResolvedValue({
        user: {
          name: "Marina Costa",
          preferredCurrency: "BRL",
          monthlyIncome: 8500,
        },
        tasks: {
          todayCount: 2,
          overdueCount: 1,
          items: [
            {
              title: "Pagar energia",
              dueDate: "2026-03-27T10:00:00.000Z",
              priority: "HIGH",
              category: { name: "Casa" },
              hasFinancialImpact: true,
              estimatedAmount: 220,
            },
          ],
        },
        finances: {
          balance: 2400,
          monthlyExpenses: 1900,
          monthlyIncome: 5200,
          recentTransactions: [
            {
              description: "Conta de energia",
              type: "EXPENSE",
              amount: 220,
              date: "2026-03-25T10:00:00.000Z",
              category: { name: "Casa" },
            },
          ],
        },
        goals: [
          {
            title: "Viagem",
            currentAmount: 3900,
            targetAmount: 10000,
            status: "ACTIVE",
            targetDate: "2026-07-15T10:00:00.000Z",
          },
        ],
        reminders: [],
        notifications: [],
        insights: [],
        forecast: {
          predictedBalance: 1700,
          riskLevel: "MEDIUM",
        },
        ...overrides,
      }),
    }) as any;

  const buildConfigService = (overrides: Record<string, string> = {}) =>
    ({
      get: jest.fn((key: string) => overrides[key] ?? ""),
    }) as any;

  const buildPrismaService = (
    overrides: {
      privacyNoticeAcceptedAt?: Date | null;
      aiAssistantEnabled?: boolean;
      aiAssistantConsentAt?: Date | null;
      transactions?: unknown[];
    } = {},
  ) =>
    ({
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          name: "Marina Costa",
          privacyNoticeAcceptedAt:
            overrides.privacyNoticeAcceptedAt ??
            new Date("2026-03-26T12:00:00.000Z"),
          aiAssistantEnabled: overrides.aiAssistantEnabled ?? true,
          aiAssistantConsentAt:
            overrides.aiAssistantConsentAt ??
            new Date("2026-03-26T12:00:00.000Z"),
        }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue(overrides.transactions ?? []),
      },
    }) as any;

  it("builds a financial answer when asked about money and external AI is disabled", async () => {
    const service = new AssistantService(
      buildDashboardService(),
      buildConfigService(),
      buildPrismaService({
        privacyNoticeAcceptedAt: null,
        aiAssistantEnabled: false,
        aiAssistantConsentAt: null,
      }),
      { create: jest.fn() } as any,
      { create: jest.fn() } as any,
      { create: jest.fn() } as any,
    );
    const response = await service.ask(
      "user-1",
      "Como esta minha vida financeira?",
    );

    expect(response.answer).toContain("saldo");
    expect(response.suggestedActions.length).toBeGreaterThan(0);
    expect(response.actions.length).toBeGreaterThan(0);
    expect(response.simulations.length).toBeGreaterThan(0);
    expect(response.source).toBe("lumen_fallback");
    expect(response.disclaimer).toContain("privacidade");
  });

  it("uses SelahIA when the integration is enabled and available", async () => {
    const service = new AssistantService(
      buildDashboardService(),
      buildConfigService({
        SELAH_ASSISTANT_ENABLED: "true",
        SELAH_BASE_URL: "http://localhost:3010",
        SELAH_ASSISTANT_ROUTE: "/v1/adapters/lumen/life-assistant/chat",
        SELAH_SOURCE_APP: "LumenBack",
        SELAH_TIMEOUT_MS: "2500",
      }),
      buildPrismaService(),
      { create: jest.fn() } as any,
      { create: jest.fn() } as any,
      { create: jest.fn() } as any,
    );

    const postJsonSpy = jest.spyOn(service as any, "postJson").mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        answer:
          "Comece por Pagar energia agora, porque ela vence antes e carrega impacto direto no caixa.",
        highlights: ["Conta de energia segue como a saida mais urgente do contexto."],
        suggestedActions: ["Concluir Pagar energia ainda hoje."],
        focusArea: "Prioridades",
        confidence: "high",
        disclaimer: null,
        provider: "SelahIA",
        model: "gemini-2.5-flash",
        generatedAt: "2026-03-26T12:00:00.000Z",
      }),
    });

    const response = await service.ask(
      "user-1",
      "O que devo priorizar agora? Meu email e marina@exemplo.com",
    );
    const [, body] = postJsonSpy.mock.calls[0];
    const payload = JSON.parse(String(body));

    expect(response.source).toBe("selah_ia");
    expect(response.provider).toBe("SelahIA");
    expect(response.focusArea).toBe("Prioridades");
    expect(response.explainability.evidence.length).toBeGreaterThan(0);
    expect(response.continuity.followUpPrompt).toBeTruthy();
    expect(payload.intent).toBe("priorities");
    expect(payload.focusAreaHint).toBe("Prioridades");
    expect(payload.originModule).toBe("general");
    expect(payload.applicationPromptContext).toContain(
      "Usuario em analise: Marina.",
    );
    expect(payload.applicationPromptContext).toContain(
      "Tarefas abertas relevantes:",
    );
    expect(payload.applicationPromptContext).not.toContain(
      "Hoje eu puxaria a fila",
    );
    expect(payload.message).not.toContain("marina@exemplo.com");
    expect(payload.message).toContain("[email removido]");
    expect(payload.questionContextSummary).toContain("prioridade");
    expect(postJsonSpy).toHaveBeenCalled();
  });

  describe("personalized simulations", () => {
    const monthDate = (offset: number) => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth() - offset, 5).toISOString();
    };

    it("picks the real variable-spending category over the flat 10%, and the real average surplus over the flat 8 months", async () => {
      const transactions = [
        { type: "INCOME", amount: 5000, date: monthDate(0), category: null },
        { type: "INCOME", amount: 5000, date: monthDate(1), category: null },
        { type: "INCOME", amount: 5000, date: monthDate(2), category: null },
        { type: "EXPENSE", amount: 500, date: monthDate(0), category: { name: "Lazer" } },
        { type: "EXPENSE", amount: 100, date: monthDate(1), category: { name: "Lazer" } },
        { type: "EXPENSE", amount: 300, date: monthDate(2), category: { name: "Lazer" } },
        { type: "EXPENSE", amount: 1200, date: monthDate(0), category: { name: "Aluguel" } },
        { type: "EXPENSE", amount: 1200, date: monthDate(1), category: { name: "Aluguel" } },
        { type: "EXPENSE", amount: 1200, date: monthDate(2), category: { name: "Aluguel" } },
      ];

      const service = new AssistantService(
        buildDashboardService(),
        buildConfigService(),
        buildPrismaService({
          privacyNoticeAcceptedAt: null,
          aiAssistantEnabled: false,
          aiAssistantConsentAt: null,
          transactions,
        }),
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
      );

      const response = await service.ask(
        "user-1",
        "Tenho uma dívida de R$ 10.500, como organizo isso?",
      );

      // Aluguel tem o maior total (3.600), mas e fixo (mesmo valor todo mes)
      // — so Lazer oscila mes a mes, entao e ela que deve ser sugerida.
      const expenseSim = response.simulations.find(
        (sim) => sim.id === "expense-trim-category",
      );
      expect(expenseSim?.title).toBe("Corte em Lazer");
      expect(expenseSim?.summary).toContain("Lazer");
      expect(expenseSim?.summary).not.toContain("Aluguel");

      // Sobra media real: (3300+3700+3500)/3 = 3500/mes -> 10500/3500 = 3 meses.
      const debtSim = response.simulations.find((sim) => sim.id === "debt-personalized");
      expect(debtSim?.title).toBe("Parcelamento em 3 meses");
      expect(debtSim?.monthlyDelta).toBe(-3500);
    });

    it("falls back to the flat 10% cut and 8-month split without transaction history", async () => {
      const service = new AssistantService(
        buildDashboardService(),
        buildConfigService(),
        buildPrismaService({
          privacyNoticeAcceptedAt: null,
          aiAssistantEnabled: false,
          aiAssistantConsentAt: null,
          transactions: [],
        }),
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
      );

      const response = await service.ask(
        "user-1",
        "Tenho uma dívida de R$ 8.000, como organizo isso?",
      );

      expect(response.simulations.map((sim) => sim.id)).toContain("expense-trim-10");
      expect(response.simulations.map((sim) => sim.id)).toContain("debt-8x");
    });
  });

  describe("proactive signals", () => {
    const buildService = (dashboardOverrides: Record<string, unknown> = {}) =>
      new AssistantService(
        buildDashboardService(dashboardOverrides),
        buildConfigService(),
        buildPrismaService({
          privacyNoticeAcceptedAt: null,
          aiAssistantEnabled: false,
          aiAssistantConsentAt: null,
        }),
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
      );

    it("surfaces cash-risk from the forecast even without any insight", async () => {
      const service = buildService({
        forecast: { predictedBalance: -400, riskLevel: "HIGH" },
      });

      const response = await service.ask("user-1", "Como estou hoje?");

      expect(response.proactiveSignals.map((signal) => signal.id)).toContain(
        "cash-risk",
      );
    });

    it("maps an insight into a signal using its persona as the title", async () => {
      const service = buildService({
        forecast: { predictedBalance: 1700, riskLevel: "MEDIUM" },
        insights: [
          {
            type: "FINANCE",
            severity: "WARNING",
            message: "Suas despesas ja passaram de 85% da renda do mes.",
            fingerprint: "FINANCE:expense_ratio:WARNING",
            metadata: { persona: { name: "Lastro", role: "cuida do seu mes" } },
          },
        ],
      });

      const response = await service.ask("user-1", "Como estou hoje?");
      const signal = response.proactiveSignals.find((entry) => entry.title === "Lastro");

      expect(signal).toBeDefined();
      expect(signal?.severity).toBe("warning");
      expect(signal?.targetModule).toBe("finances");
    });

    it("excludes the calm fallback insight once the user asked something specific", async () => {
      const service = buildService({
        forecast: { predictedBalance: 1700, riskLevel: "MEDIUM" },
        insights: [
          {
            type: "ROUTINE",
            severity: "INFO",
            message: "Seu momento parece equilibrado.",
            fingerprint: "ROUTINE:calm:INFO",
            metadata: { persona: { name: "Compasso", role: "observa o ritmo" } },
          },
        ],
      });

      const response = await service.ask("user-1", "Como estou hoje?");

      expect(response.proactiveSignals).toHaveLength(0);
    });

    it("keeps the calm fallback insight in the pulse, where there is no active question", async () => {
      const service = buildService({
        forecast: { predictedBalance: 1700, riskLevel: "MEDIUM" },
        insights: [
          {
            type: "ROUTINE",
            severity: "INFO",
            message: "Seu momento parece equilibrado.",
            fingerprint: "ROUTINE:calm:INFO",
            metadata: { persona: { name: "Compasso", role: "observa o ritmo" } },
          },
        ],
      });

      const pulse = await service.getPulse("user-1");

      expect(pulse.signals.map((signal) => signal.title)).toContain("Compasso");
    });

    it("routes a ROUTINE insight to the module the question came from", async () => {
      const service = buildService({
        forecast: { predictedBalance: 1700, riskLevel: "MEDIUM" },
        insights: [
          {
            type: "ROUTINE",
            severity: "INFO",
            message: "Hoje voce tem 5 compromissos ativos.",
            fingerprint: "ROUTINE:busy_day:INFO",
            metadata: { persona: { name: "Compasso", role: "observa o ritmo" } },
          },
        ],
      });

      const response = await service.ask("user-1", "Como estou hoje?", {
        originModule: "tasks",
      });
      const signal = response.proactiveSignals.find((entry) => entry.title === "Compasso");

      expect(signal?.targetModule).toBe("tasks");
    });

    it("caps signals at three even with cash-risk plus multiple insights", async () => {
      const service = buildService({
        forecast: { predictedBalance: -400, riskLevel: "HIGH" },
        insights: [
          {
            type: "PRODUCTIVITY",
            severity: "CRITICAL",
            message: "Tarefas atrasadas.",
            fingerprint: "PRODUCTIVITY:overdue_tasks:CRITICAL",
            metadata: { persona: { name: "Norte", role: "" } },
          },
          {
            type: "GOAL",
            severity: "WARNING",
            message: "Meta travada.",
            fingerprint: "GOAL:stalled_goals:WARNING",
            metadata: { persona: { name: "Horizonte", role: "" } },
          },
          {
            type: "FINANCE",
            severity: "WARNING",
            message: "Cobranca duplicada.",
            fingerprint: "FINANCE:duplicate_charges:abc123:WARNING",
            metadata: { persona: { name: "Lastro", role: "" } },
          },
        ],
      });

      const response = await service.ask("user-1", "Como estou hoje?");

      expect(response.proactiveSignals).toHaveLength(3);
    });
  });
});
