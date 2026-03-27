import { AssistantService } from "./assistant.service";

describe("AssistantService", () => {
  const buildDashboardService = () =>
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
    );
    const response = await service.ask(
      "user-1",
      "Como esta minha vida financeira?",
    );

    expect(response.answer).toContain("saldo");
    expect(response.suggestedActions.length).toBeGreaterThan(0);
    expect(response.source).toBe("lumen_fallback");
    expect(response.disclaimer).toContain("privacidade");
  });

  it("uses SelahIA when the integration is enabled and available", async () => {
    const originalFetch = global.fetch;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        answer:
          "Hoje o melhor foco e fechar pendencias com custo e proteger o caixa.",
        highlights: ["2 tarefas pedem atencao imediata."],
        suggestedActions: ["Quitar a conta de energia ainda hoje."],
        focusArea: "Prioridades",
        confidence: "high",
        disclaimer: null,
        provider: "SelahIA",
        model: "gemini-2.5-flash",
        generatedAt: "2026-03-26T12:00:00.000Z",
      }),
    }) as any;

    try {
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
      );

      const response = await service.ask(
        "user-1",
        "O que devo priorizar agora? Meu email e marina@exemplo.com",
      );
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const fetchOptions = fetchCall[1] as RequestInit;
      const payload = JSON.parse(String(fetchOptions.body));

      expect(response.source).toBe("selah_ia");
      expect(response.provider).toBe("SelahIA");
      expect(response.focusArea).toBe("Prioridades");
      expect(payload.intent).toBe("priorities");
      expect(payload.focusAreaHint).toBe("Prioridades");
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
      expect(global.fetch).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
