import { FORECASTS_QUEUE } from "./life-engine.service";
import { buildService } from "./life-workers.test-helpers";
import { resetWorkers, workerFor } from "./life-workers.worker-helpers";
import { NOW_MONDAY } from "./life-workers.test-helpers";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation((queue: string, processor: unknown) => ({
    queue,
    processor,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

async function setup(configure: (deps: ReturnType<typeof buildService>["deps"]) => void = () => undefined) {
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

  describe("forecasts worker", () => {
    it("risco HIGH gera notificacao FORECAST", async () => {
      const { deps } = await setup((d) => {
        d.forecasts.recalculateForUser.mockResolvedValue({ riskLevel: "HIGH" });
      });

      await workerFor(FORECASTS_QUEUE).processor({ data: { userId: 3 } });

      expect(deps.forecasts.recalculateForUser.mock.calls).toMatchSnapshot();
      expect(deps.notifications.createNotification.mock.calls).toMatchSnapshot();
    });

    it("risco MEDIUM ou LOW nao notifica", async () => {
      const { deps } = await setup((d) => {
        d.forecasts.recalculateForUser.mockResolvedValue({ riskLevel: "MEDIUM" });
      });

      await workerFor(FORECASTS_QUEUE).processor({ data: { userId: 3 } });

      expect(deps.notifications.createNotification).not.toHaveBeenCalled();
    });

    it("erro no recalculo propaga para o BullMQ", async () => {
      await setup((d) => {
        d.forecasts.recalculateForUser.mockRejectedValue(new Error("sem saldo"));
      });

      await expect(workerFor(FORECASTS_QUEUE).processor({ data: { userId: 3 } })).rejects.toThrow(
        "sem saldo",
      );
    });
  });
});
