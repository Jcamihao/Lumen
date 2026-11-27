import { ReminderStatus } from "@prisma/client";
import { REMINDERS_QUEUE } from "./life-engine.service";
import { buildDeps, buildService, eligibleUser, NOW_MONDAY } from "./life-workers.test-helpers";
import { captureLogs, resetWorkers, workerFor } from "./life-workers.worker-helpers";

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

  describe("reminders worker", () => {
    const reminder = (overrides: Record<string, unknown> = {}) => ({
      id: "rem-1",
      userId: "user-1",
      title: "Pagar conta",
      remindAt: new Date("2026-03-02T12:00:00.000Z"),
      status: ReminderStatus.SCHEDULED,
      user: eligibleUser,
      task: { title: "Pagar luz" },
      transaction: null,
      goal: null,
      ...overrides,
    });

    async function run(row: unknown, setup: (deps: ReturnType<typeof buildDeps>) => void = () => undefined) {
      const { service, deps } = buildService();
      deps.prisma.reminder.findUnique.mockResolvedValue(row);
      setup(deps);
      const { logs, restore } = captureLogs();
      restoreLogs = restore;
      await service.onModuleInit();
      await workerFor(REMINDERS_QUEUE).processor({ data: { reminderId: 42 } });
      return { deps, logs };
    }

    it("lembrete inexistente ou ja enviado nao faz nada", async () => {
      const missing = await run(null);
      expect(missing.deps.prisma.reminder.update).not.toHaveBeenCalled();
      expect(missing.deps.notifications.createNotification).not.toHaveBeenCalled();

      const sent = await run(reminder({ status: ReminderStatus.SENT }));
      expect(sent.deps.prisma.reminder.update).not.toHaveBeenCalled();
      expect(sent.deps.mail.sendReminderEmail).not.toHaveBeenCalled();
    });

    it("agendado com tarefa: marca SENT, notifica com contexto e envia email", async () => {
      const { deps, logs } = await run(reminder());

      expect(deps.prisma.reminder.findUnique.mock.calls).toMatchSnapshot();
      expect(deps.prisma.reminder.update.mock.calls).toMatchSnapshot();
      expect(deps.notifications.createNotification.mock.calls).toMatchSnapshot();
      expect(deps.mail.sendReminderEmail.mock.calls).toMatchSnapshot();
      expect(logs).toMatchSnapshot();
    });

    it("sem contexto relacionado usa a mensagem curta e nao envia email nao elegivel", async () => {
      const { deps } = await run(
        reminder({ task: null, user: { ...eligibleUser, emailReminders: false } }),
      );

      expect(deps.notifications.createNotification.mock.calls).toMatchSnapshot();
      expect(deps.mail.sendReminderEmail).not.toHaveBeenCalled();
    });

    it("falha no email e logada com contexto e nao propaga", async () => {
      const { deps, logs } = await run(reminder({ goal: { title: "Viagem" }, task: null }), (d) =>
        d.mail.sendReminderEmail.mockRejectedValue(new Error("smtp off")),
      );

      expect(deps.prisma.reminder.update).toHaveBeenCalledTimes(1);
      expect(logs).toMatchSnapshot();
    });
  });
});
