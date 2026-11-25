import { PlanLimitException } from "../billing/plan-limit.exception";
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
      timezone?: string;
    } = {},
  ) =>
    ({
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          name: "Marina Costa",
          timezone: overrides.timezone ?? "America/Sao_Paulo",
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

  const buildEntitlements = (overrides: Record<string, unknown> = {}) =>
    ({
      assertCanAskSelah: jest.fn().mockResolvedValue(undefined),
      recordSelahQuestion: jest.fn().mockResolvedValue(undefined),
      ...overrides,
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
      buildEntitlements(),
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
      buildEntitlements(),
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

  it("falls back to the local mode when SelahIA rate-limits this app (429)", async () => {
    const service = new AssistantService(
      buildDashboardService(),
      buildConfigService({
        SELAH_ASSISTANT_ENABLED: "true",
        SELAH_BASE_URL: "http://localhost:3010",
        SELAH_SOURCE_APP: "LumenBack",
      }),
      buildPrismaService(),
      { create: jest.fn() } as any,
      { create: jest.fn() } as any,
      { create: jest.fn() } as any,
      buildEntitlements(),
    );

    jest.spyOn(service as any, "postJson").mockResolvedValue({
      statusCode: 429,
      body: JSON.stringify({
        statusCode: 429,
        message: "Rate limit exceeded for this application.",
        retryAfterSeconds: 12,
      }),
    });

    const response = await service.ask("user-1", "O que devo priorizar agora?");

    expect(response.source).toBe("lumen_fallback");
    expect(response.disclaimer).toContain("SelahIA indisponivel");
  });

  describe("Selah quota (entitlements)", () => {
    it("rejects with the same exception and never calls Selah when assertCanAskSelah rejects", async () => {
      const entitlements = buildEntitlements({
        assertCanAskSelah: jest
          .fn()
          .mockRejectedValue(new Error("PLAN_LIMIT")),
      });
      const service = new AssistantService(
        buildDashboardService(),
        buildConfigService({
          SELAH_ASSISTANT_ENABLED: "true",
          SELAH_BASE_URL: "http://localhost:3010",
          SELAH_SOURCE_APP: "LumenBack",
        }),
        buildPrismaService(),
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
        entitlements,
      );
      const postJsonSpy = jest.spyOn(service as any, "postJson");

      await expect(
        service.ask("user-1", "O que devo priorizar agora?"),
      ).rejects.toThrow("PLAN_LIMIT");
      expect(postJsonSpy).not.toHaveBeenCalled();
    });

    it("records the Selah question once when Selah actually answers", async () => {
      const entitlements = buildEntitlements();
      const service = new AssistantService(
        buildDashboardService(),
        buildConfigService({
          SELAH_ASSISTANT_ENABLED: "true",
          SELAH_BASE_URL: "http://localhost:3010",
          SELAH_SOURCE_APP: "LumenBack",
        }),
        buildPrismaService(),
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
        entitlements,
      );

      jest.spyOn(service as any, "postJson").mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          answer: "Resposta de teste.",
          highlights: [],
          suggestedActions: [],
          focusArea: "Prioridades",
          confidence: "high",
          disclaimer: null,
          provider: "SelahIA",
          generatedAt: "2026-03-26T12:00:00.000Z",
        }),
      });

      await service.ask("user-1", "O que devo priorizar agora?");

      expect(entitlements.recordSelahQuestion).toHaveBeenCalledTimes(1);
      expect(entitlements.recordSelahQuestion).toHaveBeenCalledWith("user-1");
    });

    it("does not record the Selah question when it falls back to the local reply", async () => {
      const entitlements = buildEntitlements();
      const service = new AssistantService(
        buildDashboardService(),
        buildConfigService({
          SELAH_ASSISTANT_ENABLED: "true",
          SELAH_BASE_URL: "http://localhost:3010",
          SELAH_SOURCE_APP: "LumenBack",
        }),
        buildPrismaService(),
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
        { create: jest.fn() } as any,
        entitlements,
      );

      jest.spyOn(service as any, "postJson").mockResolvedValue({
        statusCode: 429,
        body: JSON.stringify({
          statusCode: 429,
          message: "Rate limit exceeded for this application.",
        }),
      });

      const response = await service.ask(
        "user-1",
        "O que devo priorizar agora?",
      );

      expect(response.source).toBe("lumen_fallback");
      expect(entitlements.recordSelahQuestion).not.toHaveBeenCalled();
    });
  });

  it("feeds the user's personal profile (age, occupation, primary goal) into the SelahIA context", async () => {
    // 1o de janeiro, 30 anos atras, em UTC — o mesmo jeito que birthDate
    // chega do Postgres/Prisma (timestamp a meia-noite UTC). Construir a
    // idade esperada aqui e o servico calcular do mesmo jeito garante que o
    // teste falharia se calculateAge voltasse a usar getMonth()/getDate()
    // (fuso local) em vez de getUTCMonth()/getUTCDate().
    const birthDate = new Date(Date.UTC(new Date().getUTCFullYear() - 30, 0, 1)).toISOString();

    const service = new AssistantService(
      buildDashboardService({
        user: {
          name: "Marina Costa",
          preferredCurrency: "BRL",
          monthlyIncome: 8500,
          birthDate,
          occupation: "Engenheira de dados",
          primaryGoal: "Sair das dividas e comecar a investir",
        },
      }),
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
      buildEntitlements(),
    );

    const postJsonSpy = jest.spyOn(service as any, "postJson").mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        answer: "Resposta de teste.",
        highlights: [],
        suggestedActions: [],
        focusArea: "Prioridades",
        confidence: "high",
        disclaimer: null,
        provider: "SelahIA",
        model: "gemini-2.5-flash",
        generatedAt: "2026-03-26T12:00:00.000Z",
      }),
    });

    await service.ask("user-1", "O que devo priorizar agora?");
    const [, body] = postJsonSpy.mock.calls[0];
    const payload = JSON.parse(String(body));

    expect(payload.applicationPromptContext).toContain("Perfil pessoal: 30 anos, Engenheira de dados.");
    expect(payload.applicationPromptContext).toContain(
      'Objetivo principal declarado no cadastro: "Sair das dividas e comecar a investir".',
    );
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
        buildEntitlements(),
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

    describe("meses da analise nao dependem do fuso do servidor", () => {
      // Lancamentos sao gravados como data pura a meia-noite UTC. Rode este
      // arquivo com TZ=UTC, TZ=America/Sao_Paulo e TZ=Asia/Tokyo.
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      const askDebt = async (
        transactions: unknown[],
        timezone: string,
        now: string,
      ) => {
        jest.setSystemTime(new Date(now));
        const prisma = buildPrismaService({
          privacyNoticeAcceptedAt: null,
          aiAssistantEnabled: false,
          aiAssistantConsentAt: null,
          transactions,
          timezone,
        });
        const service = new AssistantService(
          buildDashboardService(),
          buildConfigService(),
          prisma,
          { create: jest.fn() } as any,
          { create: jest.fn() } as any,
          { create: jest.fn() } as any,
          buildEntitlements(),
        );
        const response = await service.ask(
          "user-1",
          "Tenho uma dívida de R$ 9.000, como organizo isso?",
        );

        return { response, prisma };
      };
      const income = (date: string) => ({ type: "INCOME", amount: 3000, date, category: null });

      it("lancamentos do dia 1 entram no mes certo e o corte e o dia 1 UTC", async () => {
        const { response, prisma } = await askDebt(
          [
            income("2026-09-01T00:00:00.000Z"),
            income("2026-10-01T00:00:00.000Z"),
            income("2026-11-01T00:00:00.000Z"),
          ],
          "America/Sao_Paulo",
          "2026-11-16T15:00:00.000Z",
        );

        expect(prisma.transaction.findMany.mock.calls[0][0].where.date.gte).toEqual(
          new Date("2026-09-01T00:00:00.000Z"),
        );
        // 3 meses de 3.000: sobra media 3.000 -> 9.000 / 3.000 = 3 meses.
        const debtSim = response.simulations.find((sim) => sim.id === "debt-personalized");
        expect(debtSim?.title).toBe("Parcelamento em 3 meses");
        expect(debtSim?.monthlyDelta).toBe(-3000);
      });

      it("o mes atual segue o fuso do usuario, nao o do servidor", async () => {
        // 01/12 01:00Z = 30/11 22:00 em Sao Paulo: ainda e novembro.
        const transactions = [
          income("2026-09-05T00:00:00.000Z"),
          income("2026-10-05T00:00:00.000Z"),
          income("2026-11-05T00:00:00.000Z"),
        ];
        const saoPaulo = await askDebt(transactions, "America/Sao_Paulo", "2026-12-01T01:00:00.000Z");
        expect(saoPaulo.prisma.transaction.findMany.mock.calls[0][0].where.date.gte).toEqual(
          new Date("2026-09-01T00:00:00.000Z"),
        );
        expect(
          saoPaulo.response.simulations.find((sim) => sim.id === "debt-personalized")?.monthlyDelta,
        ).toBe(-3000);

        // Em UTC o mesmo instante ja e dezembro: setembro sai da janela, a sobra
        // media cai para 2.000 e a divida de 9.000 vira 5 parcelas de 1.800.
        const utc = await askDebt(transactions, "UTC", "2026-12-01T01:00:00.000Z");
        expect(utc.prisma.transaction.findMany.mock.calls[0][0].where.date.gte).toEqual(
          new Date("2026-10-01T00:00:00.000Z"),
        );
        expect(
          utc.response.simulations.find((sim) => sim.id === "debt-personalized")?.monthlyDelta,
        ).toBe(-1800);
      });

      it("virada de ano: janela de 3 meses cruza dezembro", async () => {
        const { response, prisma } = await askDebt(
          [
            income("2025-11-01T00:00:00.000Z"),
            income("2025-12-01T00:00:00.000Z"),
            income("2026-01-01T00:00:00.000Z"),
          ],
          "America/Sao_Paulo",
          "2026-01-20T15:00:00.000Z",
        );

        expect(prisma.transaction.findMany.mock.calls[0][0].where.date.gte).toEqual(
          new Date("2025-11-01T00:00:00.000Z"),
        );
        expect(
          response.simulations.find((sim) => sim.id === "debt-personalized")?.monthlyDelta,
        ).toBe(-3000);
      });
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
        buildEntitlements(),
      );

      const response = await service.ask(
        "user-1",
        "Tenho uma dívida de R$ 8.000, como organizo isso?",
      );

      expect(response.simulations.map((sim) => sim.id)).toContain("expense-trim-10");
      expect(response.simulations.map((sim) => sim.id)).toContain("debt-8x");
    });

    it("mantem os centavos na parcela da divida (nao arredonda pra inteiro)", async () => {
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
        buildEntitlements(),
      );

      const response = await service.ask(
        "user-1",
        "Tenho uma dívida de R$ 8.100, como organizo isso?",
      );

      // 8100 / 8 = 1012,50 — com Math.round virava 1013.
      const debtSim = response.simulations.find((sim) => sim.id === "debt-8x");
      expect(debtSim?.monthlyDelta).toBe(-1012.5);
    });

    it("meta com alvo definido: sugere aporte tatico", async () => {
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
        buildEntitlements(),
      );

      const response = await service.ask("user-1", "O que eu faço com minha grana esse mês?");

      expect(response.simulations.map((sim) => sim.id)).toContain("goal-contribution");
    });

    it("meta SEM alvo definido (cofrinho sem propósito): nunca sugere aporte tático (não há 'quanto falta')", async () => {
      const service = new AssistantService(
        buildDashboardService({
          goals: [
            {
              title: "Reserva de emergência",
              currentAmount: 500,
              targetAmount: null,
              status: "ACTIVE",
              targetDate: null,
            },
          ],
        }),
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
        buildEntitlements(),
      );

      const response = await service.ask("user-1", "O que eu faço com minha grana esse mês?");

      expect(response.simulations.map((sim) => sim.id)).not.toContain("goal-contribution");
    });
  });

  describe("applyAction — create_goal", () => {
    it("sem targetAmount no payload, cria a meta sem valor-alvo (cofrinho sem propósito)", async () => {
      const goalsService = { create: jest.fn().mockResolvedValue({ id: "goal-1" }) };
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
        goalsService as any,
        { create: jest.fn() } as any,
        buildEntitlements(),
      );

      await service.applyAction("user-1", {
        kind: "create_goal",
        title: "Reserva de emergência",
        payload: {},
      } as any);

      expect(goalsService.create).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ title: "Reserva de emergência", targetAmount: undefined }),
      );
    });

    it("com targetAmount valido no payload, continua criando com o valor", async () => {
      const goalsService = { create: jest.fn().mockResolvedValue({ id: "goal-1" }) };
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
        goalsService as any,
        { create: jest.fn() } as any,
        buildEntitlements(),
      );

      await service.applyAction("user-1", {
        kind: "create_goal",
        title: "Viagem",
        payload: { targetAmount: 5000 },
      } as any);

      expect(goalsService.create).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ targetAmount: 5000 }),
      );
    });

    it("com targetAmount invalido (negativo ou zero) no payload, recusa", async () => {
      const goalsService = { create: jest.fn() };
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
        goalsService as any,
        { create: jest.fn() } as any,
        buildEntitlements(),
      );

      await expect(
        service.applyAction("user-1", {
          kind: "create_goal",
          title: "Viagem",
          payload: { targetAmount: -10 },
        } as any),
      ).rejects.toThrow();
      expect(goalsService.create).not.toHaveBeenCalled();
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
        buildEntitlements(),
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

  describe("tryFallbackAnswer (fallback do motor de conversa, item 7)", () => {
    const SELAH_ON = {
      SELAH_ASSISTANT_ENABLED: "true",
      SELAH_BASE_URL: "http://localhost:3010",
      SELAH_SOURCE_APP: "LumenBack",
    };

    const buildFallbackService = ({
      config = SELAH_ON,
      prisma = buildPrismaService(),
      dashboard = buildDashboardService(),
      entitlements = buildEntitlements(),
    }: {
      config?: Record<string, string>;
      prisma?: any;
      dashboard?: any;
      entitlements?: any;
    } = {}) => {
      const writeServices = {
        tasks: { create: jest.fn() },
        goals: { create: jest.fn() },
        reminders: { create: jest.fn() },
      };
      const service = new AssistantService(
        dashboard,
        buildConfigService(config),
        prisma,
        writeServices.tasks as any,
        writeServices.goals as any,
        writeServices.reminders as any,
        entitlements,
      );
      return { service, writeServices };
    };

    const selahAnswer = (answer: string) => ({
      statusCode: 200,
      body: JSON.stringify({ answer, actions: [{ kind: "create_task" }], suggestedActions: ["Pagar já."] }),
    });

    it("sem consentimento: no_consent, sem plano, sem IA e sem cobrança", async () => {
      const entitlements = buildEntitlements();
      const prisma = buildPrismaService();
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        privacyNoticeAcceptedAt: null,
        aiAssistantEnabled: true,
        aiAssistantConsentAt: new Date("2026-03-26T12:00:00.000Z"),
      });
      const { service } = buildFallbackService({ prisma, entitlements });
      const postJsonSpy = jest.spyOn(service as any, "postJson");

      await expect(service.tryFallbackAnswer("user-1", "Como estou?")).resolves.toEqual({ status: "no_consent" });
      expect(entitlements.assertCanAskSelah).not.toHaveBeenCalled();
      expect(postJsonSpy).not.toHaveBeenCalled();
      expect(entitlements.recordSelahQuestion).not.toHaveBeenCalled();
    });

    it("IA do usuário desligada: no_consent, mesmo com aviso aceito", async () => {
      const entitlements = buildEntitlements();
      const { service } = buildFallbackService({
        prisma: buildPrismaService({ aiAssistantEnabled: false, aiAssistantConsentAt: null }),
        entitlements,
      });
      const postJsonSpy = jest.spyOn(service as any, "postJson");

      await expect(service.tryFallbackAnswer("user-1", "Como estou?")).resolves.toEqual({ status: "no_consent" });
      expect(postJsonSpy).not.toHaveBeenCalled();
      expect(entitlements.recordSelahQuestion).not.toHaveBeenCalled();
    });

    it("IA ligada mas sem data de consentimento: no_consent, sem plano, sem IA e sem cobrança", async () => {
      const entitlements = buildEntitlements();
      const prisma = buildPrismaService();
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        privacyNoticeAcceptedAt: new Date("2026-03-26T12:00:00.000Z"),
        aiAssistantEnabled: true,
        aiAssistantConsentAt: null,
      });
      const { service } = buildFallbackService({ prisma, entitlements });
      const postJsonSpy = jest.spyOn(service as any, "postJson");

      await expect(service.tryFallbackAnswer("user-1", "Como estou?")).resolves.toEqual({ status: "no_consent" });
      expect(entitlements.assertCanAskSelah).not.toHaveBeenCalled();
      expect(postJsonSpy).not.toHaveBeenCalled();
      expect(entitlements.recordSelahQuestion).not.toHaveBeenCalled();
    });

    it("falha que não é limite de plano não vira blocked_by_plan: sobe para o motor tratar", async () => {
      const entitlements = buildEntitlements({
        assertCanAskSelah: jest.fn().mockRejectedValue(new Error("banco fora do ar")),
      });
      const { service } = buildFallbackService({ entitlements });
      const postJsonSpy = jest.spyOn(service as any, "postJson");

      await expect(service.tryFallbackAnswer("user-1", "Como estou?")).rejects.toThrow("banco fora do ar");
      expect(postJsonSpy).not.toHaveBeenCalled();
      expect(entitlements.recordSelahQuestion).not.toHaveBeenCalled();
    });

    it("sem crédito no plano: blocked_by_plan, sem chamar a IA nem cobrar", async () => {
      const entitlements = buildEntitlements({
        assertCanAskSelah: jest.fn().mockRejectedValue(
          new PlanLimitException({ resource: "selahQuestions", limit: 10, used: 10, plan: "FREE" }),
        ),
      });
      const { service } = buildFallbackService({ entitlements });
      const postJsonSpy = jest.spyOn(service as any, "postJson");

      await expect(service.tryFallbackAnswer("user-1", "Como estou?")).resolves.toEqual({ status: "blocked_by_plan" });
      expect(postJsonSpy).not.toHaveBeenCalled();
      expect(entitlements.recordSelahQuestion).not.toHaveBeenCalled();
    });

    it("resposta da IA: answered só com o texto de answer, cobra uma vez e não escreve nada", async () => {
      const entitlements = buildEntitlements();
      const { service, writeServices } = buildFallbackService({ entitlements });
      const postJsonSpy = jest
        .spyOn(service as any, "postJson")
        .mockResolvedValue(selahAnswer("  Seu caixa fecha no azul.  "));

      await expect(service.tryFallbackAnswer("user-1", "Como estou?")).resolves.toEqual({
        status: "answered",
        text: "Seu caixa fecha no azul.",
      });
      expect(postJsonSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(postJsonSpy.mock.calls[0][1]));
      expect(payload.originModule).toBe("general");
      expect(payload.message).toBe("Como estou?");
      expect(entitlements.recordSelahQuestion).toHaveBeenCalledTimes(1);
      expect(entitlements.recordSelahQuestion).toHaveBeenCalledWith("user-1");
      expect(writeServices.tasks.create).not.toHaveBeenCalled();
      expect(writeServices.goals.create).not.toHaveBeenCalled();
      expect(writeServices.reminders.create).not.toHaveBeenCalled();
    });

    it.each([
      ["erro HTTP", { statusCode: 500, body: "erro" }],
      ["payload inválido", { statusCode: 200, body: "não é json" }],
      ["resposta vazia", { statusCode: 200, body: JSON.stringify({ answer: "   " }) }],
    ])("%s: unavailable, sem inventar resposta e sem cobrar", async (_label, response) => {
      const entitlements = buildEntitlements();
      const { service } = buildFallbackService({ entitlements });
      jest.spyOn(service as any, "postJson").mockResolvedValue(response);

      await expect(service.tryFallbackAnswer("user-1", "Como estou?")).resolves.toEqual({ status: "unavailable" });
      expect(entitlements.recordSelahQuestion).not.toHaveBeenCalled();
    });

    it("integração do Selah desligada: unavailable, sem chamada externa e sem cobrança", async () => {
      const entitlements = buildEntitlements();
      const { service } = buildFallbackService({
        config: { ...SELAH_ON, SELAH_ASSISTANT_ENABLED: "false" },
        entitlements,
      });
      const postJsonSpy = jest.spyOn(service as any, "postJson");

      await expect(service.tryFallbackAnswer("user-1", "Como estou?")).resolves.toEqual({ status: "unavailable" });
      expect(postJsonSpy).not.toHaveBeenCalled();
      expect(entitlements.recordSelahQuestion).not.toHaveBeenCalled();
    });

    it("usa SELAH_FALLBACK_TIMEOUT_MS (padrão 15 s), e não o timeout do assistente legado", async () => {
      const { service } = buildFallbackService();
      const postJsonSpy = jest.spyOn(service as any, "postJson").mockResolvedValue(selahAnswer("Ok."));
      await service.tryFallbackAnswer("user-1", "Como estou?");
      expect(postJsonSpy.mock.calls[0][3]).toBe(15000);

      const custom = buildFallbackService({ config: { ...SELAH_ON, SELAH_FALLBACK_TIMEOUT_MS: "4000", SELAH_TIMEOUT_MS: "50000" } });
      const customSpy = jest.spyOn(custom.service as any, "postJson").mockResolvedValue(selahAnswer("Ok."));
      await custom.service.tryFallbackAnswer("user-1", "Como estou?");
      expect(customSpy.mock.calls[0][3]).toBe(4000);
    });

    it("o corpo enviado ao Selah só tem dados do dono: nada do outro usuário e nenhum campo de escrita", async () => {
      const summaries: Record<string, any> = {};
      for (const [id, name, title] of [
        ["user-A", "Alice Segredo", "Cirurgia secreta da Alice"],
        ["user-B", "Beto Aberto", "Reforma do Beto"],
      ]) {
        summaries[id] = (await buildDashboardService({ user: { name, preferredCurrency: "BRL", monthlyIncome: 100 } }).getSummary());
        summaries[id].goals = [{ title, currentAmount: 1, targetAmount: 2, status: "ACTIVE", targetDate: "2026-07-15T10:00:00.000Z" }];
      }
      const dashboard = { getSummary: jest.fn(async (id: string) => summaries[id]) };
      const { service } = buildFallbackService({ dashboard });
      const postJsonSpy = jest.spyOn(service as any, "postJson").mockResolvedValue(selahAnswer("Ok."));

      await service.tryFallbackAnswer("user-B", "Como estou?");

      const body = String(postJsonSpy.mock.calls[0][1]);
      expect(body).toContain("Reforma do Beto");
      expect(body).toContain("Beto");
      expect(body).not.toContain("Alice");
      expect(body).not.toContain("Cirurgia secreta");
      const payload = JSON.parse(body);
      expect(Object.keys(payload).filter((key) => /^(actions?|tools?|commands?|write|create)/i.test(key))).toEqual([]);
    });

    it.each(["abc", "0", "-5"])("SELAH_FALLBACK_TIMEOUT_MS inválido (%s) volta ao padrão de 15 s", async (invalid) => {
      const { service } = buildFallbackService({ config: { ...SELAH_ON, SELAH_FALLBACK_TIMEOUT_MS: invalid } });
      const postJsonSpy = jest.spyOn(service as any, "postJson").mockResolvedValue(selahAnswer("Ok."));

      await service.tryFallbackAnswer("user-1", "Como estou?");

      expect(postJsonSpy.mock.calls[0][3]).toBe(15000);
    });

    it("lê o resumo e o consentimento só do próprio usuário autenticado", async () => {
      const dashboard = buildDashboardService();
      const prisma = buildPrismaService();
      const { service } = buildFallbackService({ dashboard, prisma });
      jest.spyOn(service as any, "postJson").mockResolvedValue(selahAnswer("Ok."));

      await service.tryFallbackAnswer("user-A", "Como estou?");
      await service.tryFallbackAnswer("user-B", "Como estou?");

      expect(dashboard.getSummary).toHaveBeenCalledWith("user-A");
      expect(dashboard.getSummary).toHaveBeenCalledWith("user-B");
      expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-A" } }));
      expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-B" } }));
    });
  });
});
