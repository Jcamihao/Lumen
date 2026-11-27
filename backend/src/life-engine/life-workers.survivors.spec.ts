import { Prisma, ReminderStatus } from "@prisma/client";
import { INSIGHTS_QUEUE, REMINDERS_QUEUE } from "./life-engine.service";
import { eligibleUser, buildService, NOW_MONDAY, NOW_SUNDAY_DAY_ONE } from "./life-workers.test-helpers";
import { captureLogs, resetWorkers, runPulse, workerFor } from "./life-workers.worker-helpers";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation((queue: string, processor: unknown) => ({
    queue,
    processor,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const UTC_USER = { ...eligibleUser, id: "user-utc", timezone: "UTC" };
const goal = (overrides: Record<string, unknown> = {}) => ({
  id: "goal-1", userId: "user-1", title: "Reserva", status: "ACTIVE",
  recurringAmount: new Prisma.Decimal("250"), recurringDay: 1,
  currentAmount: new Prisma.Decimal("750"), targetAmount: new Prisma.Decimal("1000"),
  ...overrides,
});

describe("LifeWorkersService: invariantes (mutantes sobreviventes)", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW_MONDAY);
    resetWorkers();
  });
  afterEach(() => jest.useRealTimers());

  it("lembrete que nao esta SCHEDULED nao e reenviado", async () => {
    const { service, deps } = buildService();
    deps.prisma.reminder.findUnique.mockResolvedValue({ id: "r1", userId: "user-1", status: ReminderStatus.SENT });
    await service.onModuleInit();
    await workerFor(REMINDERS_QUEUE).processor({ data: { reminderId: "r1" } });

    expect(deps.prisma.reminder.update).not.toHaveBeenCalled();
    expect(deps.notifications.createNotification).not.toHaveBeenCalled();
  });

  it("insights: refresh, depois notifica pendentes, depois escala", async () => {
    const { service, deps } = buildService();
    deps.insights.takePendingNotifications.mockResolvedValue([{ id: "i1", message: "m", metadata: null }]);
    await service.onModuleInit();
    await workerFor(INSIGHTS_QUEUE).processor({ data: { userId: "user-1" } });

    const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
    expect(order(deps.insights.refreshForUser)).toBeLessThan(order(deps.insights.takePendingNotifications));
    expect(order(deps.notifications.createNotification)).toBeLessThan(order(deps.prisma.insight.findMany));
  });

  it("falha no email de escalada e logada e nao impede marcar escalatedAt", async () => {
    const { service, deps } = buildService();
    deps.prisma.insight.findMany.mockResolvedValue([{ id: "ins-1", message: "critico" }]);
    deps.prisma.user.findUnique.mockResolvedValue(eligibleUser);
    deps.mail.sendInsightEscalationEmail.mockRejectedValue(new Error("smtp down"));
    const { logs, restore } = captureLogs();
    await service.onModuleInit();
    await workerFor(INSIGHTS_QUEUE).processor({ data: { userId: "user-1" } });
    restore();

    expect(logs).toContainEqual(["warn", "LifeWorkersService", "insight_escalation_email_failed insightId=ins-1 reason=smtp down"]);
    expect(deps.prisma.insight.updateMany).toHaveBeenCalledTimes(1);
  });

  it("pulse sem ninguem na hora alvo nao loga resumo", async () => {
    const { logs } = await runPulse(NOW_MONDAY, (d) => d.prisma.user.findMany.mockResolvedValue([UTC_USER]));

    expect(logs.filter(([, , message]) => String(message).startsWith("pulse_scan"))).toEqual([]);
  });

  it("meia-noite local (hora 0) bate a hora alvo 0", async () => {
    const { deps } = await runPulse(new Date("2026-03-02T00:30:00.000Z"), (d) => {
      d.config.get.mockImplementation((key: string, fallback: unknown) => (key === "app.selahPulseHourLocal" ? 0 : fallback));
      d.prisma.user.findMany.mockResolvedValue([UTC_USER]);
    });

    expect(deps.lifeEngine.touchUserData).toHaveBeenCalledWith("user-utc");
  });

  it("aporte que iguala o alvo conclui a meta e grava a transferencia ligada a meta", async () => {
    const { deps } = await runPulse(NOW_SUNDAY_DAY_ONE, (d) => {
      d.prisma.user.findMany.mockResolvedValue([eligibleUser]);
      d.prisma.goal.findMany.mockResolvedValue([goal()]);
    });

    expect(deps.prisma.goal.update.mock.calls[0][0].data.status).toBe("ACHIEVED");
    const created = deps.prisma.transaction.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ type: "TRANSFER", linkedGoalId: "goal-1", userId: "user-1" });
  });

  it("falha no digest e logada, nao avanca lastWeeklyDigestAt e nao derruba o scan", async () => {
    const { deps, logs } = await runPulse(NOW_MONDAY, (d) => {
      d.prisma.user.findMany.mockResolvedValue([eligibleUser]);
      d.prisma.user.findUnique.mockResolvedValue(eligibleUser);
      d.dashboard.getSummary.mockRejectedValue(new Error("db off"));
    });

    expect(logs).toContainEqual(["warn", "LifeWorkersService", "weekly_digest_failed userId=user-1 reason=db off"]);
    expect(deps.prisma.user.update).not.toHaveBeenCalled();
  });
});
