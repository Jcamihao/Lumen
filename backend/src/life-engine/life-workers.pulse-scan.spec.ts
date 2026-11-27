import { Prisma } from "@prisma/client";
import { PULSE_SCAN_QUEUE } from "./life-engine.service";
import { buildDeps, buildService, eligibleUser, NOW_MONDAY, NOW_SUNDAY_DAY_ONE } from "./life-workers.test-helpers";
import { captureLogs, resetWorkers, workerFor, runPulse } from "./life-workers.worker-helpers";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation((queue: string, processor: unknown) => ({
    queue,
    processor,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const UTC_USER = { ...eligibleUser, id: "user-utc", timezone: "UTC" };
const BROKEN_TZ_USER = { ...eligibleUser, id: "user-bad", timezone: "Mars/Base" };
const goal = (overrides: Record<string, unknown> = {}) => ({
  id: "goal-1",
  userId: "user-1",
  title: "Reserva",
  status: "ACTIVE",
  recurringAmount: new Prisma.Decimal("250.00"),
  recurringDay: 1,
  currentAmount: new Prisma.Decimal("900"),
  targetAmount: new Prisma.Decimal("1000"),
  ...overrides,
});

describe("LifeWorkersService: pulse scan", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW_SUNDAY_DAY_ONE);
    resetWorkers();
  });

  afterEach(() => jest.useRealTimers());

  it("so processa quem esta na hora local alvo e materializa todos antes do filtro", async () => {
    const { deps, logs } = await runPulse(NOW_SUNDAY_DAY_ONE, (d) => {
      d.prisma.user.findMany.mockResolvedValue([eligibleUser, UTC_USER, BROKEN_TZ_USER]);
      d.recurring.materializeDue.mockResolvedValueOnce(2);
    });

    expect(deps.recurring.materializeDue.mock.calls).toMatchSnapshot();
    expect(deps.installments.materializeDue.mock.calls).toMatchSnapshot();
    expect(deps.lifeEngine.touchUserData.mock.calls).toMatchSnapshot();
    expect(deps.forecasts.resolveMatureSnapshots.mock.calls).toMatchSnapshot();
    expect(logs).toMatchSnapshot();
  });

  it("dia 1 do mes: aporte recorrente de meta e disparado (recurringDay 1)", async () => {
    const { deps, logs } = await runPulse(NOW_SUNDAY_DAY_ONE, (d) => {
      d.prisma.user.findMany.mockResolvedValue([eligibleUser]);
      d.prisma.goal.findMany.mockResolvedValue([
        goal(),
        goal({ id: "goal-2", title: "Cofrinho", targetAmount: null, currentAmount: new Prisma.Decimal("5") }),
      ]);
    });

    expect(deps.prisma.goal.findMany.mock.calls).toMatchSnapshot();
    expect(deps.prisma.goal.update.mock.calls.map(([arg]: any) => arg)).toMatchSnapshot();
    expect(deps.prisma.transaction.create.mock.calls.map(([arg]: any) => arg.data.amount.toString())).toEqual(["250", "250"]);
    expect(deps.notifications.createNotification.mock.calls).toMatchSnapshot();
    expect(logs).toMatchSnapshot();
  });

  it("dia diferente de 1: consulta metas do dia (recurringDay 2) e nao cria aporte", async () => {
    const { deps } = await runPulse(NOW_MONDAY, (d) => {
      d.prisma.user.findMany.mockResolvedValue([eligibleUser]);
    });

    expect(deps.prisma.goal.findMany.mock.calls[0][0].where.recurringDay).toBe(2);
    expect(deps.prisma.goal.update).not.toHaveBeenCalled();
  });

  it("falhas auxiliares sao logadas com o nome da etapa e nao derrubam o scan", async () => {
    const { deps, logs } = await runPulse(NOW_SUNDAY_DAY_ONE, (d) => {
      d.prisma.user.findMany.mockResolvedValue([eligibleUser]);
      d.recurring.materializeDue.mockRejectedValue(new Error("rec off"));
      d.installments.materializeDue.mockRejectedValue(new Error("parc off"));
      d.billReminders.sendDueReminders.mockRejectedValue(new Error("bill off"));
    });

    expect(logs).toMatchSnapshot();
    expect(deps.lifeEngine.touchUserData).toHaveBeenCalledTimes(1);
  });
});
