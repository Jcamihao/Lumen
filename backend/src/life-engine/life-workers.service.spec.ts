import { FORECASTS_QUEUE, INSIGHTS_QUEUE, PULSE_SCAN_QUEUE, REMINDERS_QUEUE } from "./life-engine.service";
import { buildDeps, buildService, NOW_MONDAY } from "./life-workers.test-helpers";
import { captureLogs, registeredWorkers, resetWorkers, workerCtor } from "./life-workers.worker-helpers";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation((queue: string, processor: unknown, options: unknown) => ({
    queue,
    processor,
    options,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe("LifeWorkersService: registro e ciclo de vida", () => {
  let restoreLogs: () => void = () => undefined;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW_MONDAY);
    resetWorkers();
  });

  afterEach(() => {
    restoreLogs();
    jest.useRealTimers();
  });

  it("sem Redis nao registra workers nem agenda o pulso", async () => {
    const { service, deps } = buildService();
    deps.cacheQueue.isReady.mockReturnValue(false);
    const { logs, restore } = captureLogs();
    restoreLogs = restore;

    await service.onModuleInit();

    expect(workerCtor()).not.toHaveBeenCalled();
    expect(deps.lifeEngine.schedulePulseScan).not.toHaveBeenCalled();
    expect(logs).toMatchSnapshot();
  });

  it("registra os 4 workers na ordem, com a conexao Redis, depois do bootstrap e do agendamento", async () => {
    const { service, deps } = buildService();

    await service.onModuleInit();

    expect(registeredWorkers().map(({ queue, options }) => ({ queue, options }))).toMatchSnapshot();
    expect([REMINDERS_QUEUE, INSIGHTS_QUEUE, FORECASTS_QUEUE, PULSE_SCAN_QUEUE]).toEqual(
      registeredWorkers().map((worker) => worker.queue),
    );
    const bootstrapOrder = deps.prisma.reminder.findMany.mock.invocationCallOrder[0];
    const scheduleOrder = deps.lifeEngine.schedulePulseScan.mock.invocationCallOrder[0];
    const registerOrder = workerCtor().mock.invocationCallOrder[0];
    expect(bootstrapOrder).toBeLessThan(scheduleOrder);
    expect(scheduleOrder).toBeLessThan(registerOrder);
  });

  it("bootstrap reagenda lembretes pendentes e loga a contagem", async () => {
    const { service, deps } = buildService();
    const remindAt = new Date("2026-03-02T12:00:00.000Z");
    deps.prisma.reminder.findMany.mockResolvedValue([{ id: "rem-1", remindAt }]);
    const { logs, restore } = captureLogs();
    restoreLogs = restore;

    await service.onModuleInit();

    expect(deps.prisma.reminder.findMany.mock.calls).toMatchSnapshot();
    expect(deps.lifeEngine.scheduleReminder.mock.calls).toMatchSnapshot();
    expect(logs).toMatchSnapshot();
  });

  it("falha no bootstrap e logada e nao impede o registro", async () => {
    const { service, deps } = buildService();
    deps.prisma.reminder.findMany.mockRejectedValue(new Error("db caiu"));
    const { logs, restore } = captureLogs();
    restoreLogs = restore;

    await service.onModuleInit();

    expect(logs).toMatchSnapshot();
    expect(deps.lifeEngine.schedulePulseScan).toHaveBeenCalledTimes(1);
    expect(registeredWorkers()).toHaveLength(4);
  });

  it("onModuleDestroy fecha todos os workers registrados", async () => {
    const { service } = buildService();
    await service.onModuleInit();

    await service.onModuleDestroy();

    expect(registeredWorkers().map((worker) => worker.close.mock.calls.length)).toEqual([1, 1, 1, 1]);
  });
});
