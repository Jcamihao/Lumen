import { InsightSeverity } from "@prisma/client";
import { INSIGHTS_QUEUE } from "./life-engine.service";
import { buildDeps, buildService, eligibleUser, NOW_MONDAY } from "./life-workers.test-helpers";
import { resetWorkers, workerFor } from "./life-workers.worker-helpers";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation((queue: string, processor: unknown) => ({
    queue,
    processor,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const insight = (overrides: Record<string, unknown> = {}) => ({
  id: "ins-1",
  message: "Fatura do cartao vence amanha",
  metadata: null,
  ...overrides,
});

async function setup(configure: (deps: ReturnType<typeof buildDeps>) => void = () => undefined) {
  const { service, deps } = buildService();
  configure(deps);
  await service.onModuleInit();
  return { deps };
}

describe("LifeWorkersService: processors de insights e previsao", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW_MONDAY);
    resetWorkers();
  });

  afterEach(() => jest.useRealTimers());

  describe("insights worker", () => {
    it("atualiza insights, notifica so os pendentes e usa a persona como titulo", async () => {
      const { deps } = await setup((d) => {
        d.insights.takePendingNotifications.mockResolvedValue([
          insight({ metadata: { persona: { name: "Ana" } } }),
          insight({ id: "ins-2", message: "Gasto acima da media", metadata: {} }),
        ]);
      });

      await workerFor(INSIGHTS_QUEUE).processor({ data: { userId: 7 } });

      expect(deps.insights.refreshForUser.mock.calls).toMatchSnapshot();
      expect(deps.insights.takePendingNotifications.mock.calls).toMatchSnapshot();
      expect(deps.notifications.createNotification.mock.calls).toMatchSnapshot();
    });

    it("escala insight critico ha dias sem resolucao por email, uma vez, e marca escalatedAt", async () => {
      const { deps } = await setup((d) => {
        d.prisma.insight.findMany.mockResolvedValue([insight({ severity: InsightSeverity.CRITICAL })]);
        d.prisma.user.findUnique.mockResolvedValue(eligibleUser);
      });

      await workerFor(INSIGHTS_QUEUE).processor({ data: { userId: "user-1" } });

      expect(deps.prisma.insight.findMany.mock.calls).toMatchSnapshot();
      expect(deps.mail.sendInsightEscalationEmail.mock.calls).toMatchSnapshot();
      expect(deps.prisma.insight.updateMany.mock.calls).toMatchSnapshot();
    });

    it("sem elegibilidade de email nao envia, mas ainda marca como escalado", async () => {
      const { deps } = await setup((d) => {
        d.prisma.insight.findMany.mockResolvedValue([insight()]);
        d.prisma.user.findUnique.mockResolvedValue({ ...eligibleUser, emailInsightAlerts: false });
      });

      await workerFor(INSIGHTS_QUEUE).processor({ data: { userId: "user-1" } });

      expect(deps.mail.sendInsightEscalationEmail).not.toHaveBeenCalled();
      expect(deps.prisma.insight.updateMany).toHaveBeenCalledTimes(1);
    });

    it("usuario inexistente na escalada encerra sem marcar nada", async () => {
      const { deps } = await setup((d) => {
        d.prisma.insight.findMany.mockResolvedValue([insight()]);
      });

      await workerFor(INSIGHTS_QUEUE).processor({ data: { userId: "user-1" } });

      expect(deps.prisma.insight.updateMany).not.toHaveBeenCalled();
    });
  });
});
