import { BillReminderService } from "./bill-reminder.service";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("BillReminderService", () => {
  const verified = new Date("2026-01-01T00:00:00.000Z");
  const baseUser = {
    id: "user-1",
    email: "marina@exemplo.com",
    name: "Marina Souza",
    timezone: "UTC",
    preferredCurrency: "BRL",
    emailVerifiedAt: verified as Date | null,
    emailBillReminders: true,
  };
  // 2026-10-01 12:00 UTC => hoje (UTC) = 2026-10-01, janela = (10-01, 10-04]
  const now = new Date("2026-10-01T12:00:00.000Z");

  const bill = (overrides: Record<string, unknown> = {}) => ({
    id: "bill-1",
    description: "Aluguel",
    amount: "1500.5",
    nextDueDate: day("2026-10-03"),
    endDate: null as Date | null,
    lastReminderForDate: null as Date | null,
    ...overrides,
  });

  const build = (rows: any[] = [bill()]) => {
    const prisma = {
      recurringTransaction: {
        findMany: jest.fn().mockResolvedValue(rows),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: rows.length }),
      },
    };
    const mail = {
      sendBillDueEmail: jest.fn().mockResolvedValue({ provider: "resend", skipped: false }),
    };
    const unsubscribe = { pageUrl: "https://app/unsub", oneClickUrl: "https://api/unsub" };
    const prefs = { buildUnsubscribeLinks: jest.fn().mockReturnValue(unsubscribe) };
    const service = new BillReminderService(prisma as any, mail as any, prefs as any);
    (service as any).logger = { warn: jest.fn(), log: jest.fn() };
    return { service, prisma, mail, prefs, unsubscribe };
  };

  const markedIds = (prisma: ReturnType<typeof build>["prisma"]) => [
    ...prisma.recurringTransaction.update.mock.calls.map(([arg]: any) => arg.where.id),
    ...prisma.recurringTransaction.updateMany.mock.calls.flatMap(([arg]: any) =>
      arg.where.id?.in ?? [arg.where.id],
    ),
  ];

  it("sends one email with every bill in the window (ordered by due date in the query) and then marks them", async () => {
    const { service, prisma, mail, prefs, unsubscribe } = build([
      bill({ id: "b-soon", description: "Aluguel", nextDueDate: day("2026-10-02") }),
      bill({ id: "b-late", description: "Internet", nextDueDate: day("2026-10-04"), amount: 100 }),
    ]);

    const sent = await service.sendDueReminders(baseUser, now);

    expect(sent).toBe(true);
    expect(mail.sendBillDueEmail).toHaveBeenCalledTimes(1);
    expect(prefs.buildUnsubscribeLinks).toHaveBeenCalledWith("user-1", "bill_due");
    expect(mail.sendBillDueEmail).toHaveBeenCalledWith({
      email: "marina@exemplo.com",
      name: "Marina Souza",
      preferredCurrency: "BRL",
      bills: [
        { description: "Aluguel", amount: 1500.5, dueDate: day("2026-10-02"), daysUntil: 1 },
        { description: "Internet", amount: 100, dueDate: day("2026-10-04"), daysUntil: 3 },
      ],
      unsubscribe,
    });
    expect(markedIds(prisma).sort()).toEqual(["b-late", "b-soon"]);
  });

  it("marks each bill with its own nextDueDate, after the email went out", async () => {
    const { service, prisma, mail } = build([
      bill({ id: "b-1", nextDueDate: day("2026-10-02") }),
      bill({ id: "b-2", nextDueDate: day("2026-10-04") }),
    ]);
    const order: string[] = [];
    mail.sendBillDueEmail.mockImplementation(async () => {
      order.push("send");
      return { provider: "resend", skipped: false };
    });
    prisma.recurringTransaction.update.mockImplementation(async () => {
      order.push("mark");
      return {};
    });

    await service.sendDueReminders(baseUser, now);

    expect(order).toEqual(["send", "mark", "mark"]);
    expect(prisma.recurringTransaction.update).toHaveBeenCalledWith({
      where: { id: "b-1" },
      data: { lastReminderForDate: day("2026-10-02") },
    });
    expect(prisma.recurringTransaction.update).toHaveBeenCalledWith({
      where: { id: "b-2" },
      data: { lastReminderForDate: day("2026-10-04") },
    });
  });

  it("queries only active EXPENSE bills of the user within (today, today+3d]", async () => {
    const { service, prisma } = build([]);

    await service.sendDueReminders(baseUser, now);

    expect(prisma.recurringTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          type: "EXPENSE",
          isActive: true,
          nextDueDate: { gt: day("2026-10-01"), lte: day("2026-10-04") },
        },
        orderBy: { nextDueDate: "asc" },
      }),
    );
  });

  it("does not send when the query returns nothing", async () => {
    const { service, mail } = build([]);

    expect(await service.sendDueReminders(baseUser, now)).toBe(false);
    expect(mail.sendBillDueEmail).not.toHaveBeenCalled();
  });

  it("drops bills already ended before their due date (endDate < nextDueDate)", async () => {
    const { service, mail, prisma } = build([
      bill({ id: "ended", nextDueDate: day("2026-10-03"), endDate: day("2026-10-02") }),
      bill({ id: "last-one", nextDueDate: day("2026-10-03"), endDate: day("2026-10-03") }),
      bill({ id: "open", nextDueDate: day("2026-10-03"), endDate: null }),
    ]);

    await service.sendDueReminders(baseUser, now);

    const [input] = mail.sendBillDueEmail.mock.calls[0];
    expect(input.bills).toHaveLength(2);
    expect(markedIds(prisma).sort()).toEqual(["last-one", "open"]);
  });

  it("does not resend a bill whose lastReminderForDate equals its nextDueDate", async () => {
    const { service, mail, prisma } = build([
      bill({ id: "done", lastReminderForDate: new Date(day("2026-10-03").getTime()) }),
      // lastReminderForDate de um ciclo anterior: o novo vencimento deve ser avisado
      bill({ id: "new-cycle", lastReminderForDate: day("2026-09-03") }),
    ]);

    await service.sendDueReminders(baseUser, now);

    const [input] = mail.sendBillDueEmail.mock.calls[0];
    expect(input.bills).toHaveLength(1);
    expect(markedIds(prisma)).toEqual(["new-cycle"]);
  });

  it("does not send nor mark anything when every bill was already reminded", async () => {
    const { service, mail, prisma } = build([
      bill({ lastReminderForDate: day("2026-10-03") }),
    ]);

    expect(await service.sendDueReminders(baseUser, now)).toBe(false);
    expect(mail.sendBillDueEmail).not.toHaveBeenCalled();
    expect(markedIds(prisma)).toEqual([]);
  });

  it("does not send nor mark when the email is not verified", async () => {
    const { service, mail, prisma } = build();

    expect(await service.sendDueReminders({ ...baseUser, emailVerifiedAt: null }, now)).toBe(false);
    expect(mail.sendBillDueEmail).not.toHaveBeenCalled();
    expect(markedIds(prisma)).toEqual([]);
  });

  it("does not send nor mark when the user turned the category off", async () => {
    const { service, mail, prisma } = build();

    expect(await service.sendDueReminders({ ...baseUser, emailBillReminders: false }, now)).toBe(false);
    expect(mail.sendBillDueEmail).not.toHaveBeenCalled();
    expect(markedIds(prisma)).toEqual([]);
  });

  it("does not mark when sending throws, logging a warning instead of rejecting", async () => {
    const { service, mail, prisma } = build();
    mail.sendBillDueEmail.mockRejectedValue(new Error("Resend caiu"));

    await expect(service.sendDueReminders(baseUser, now)).resolves.toBe(false);

    expect(markedIds(prisma)).toEqual([]);
    expect((service as any).logger.warn).toHaveBeenCalledWith(expect.stringContaining("Resend caiu"));
  });

  it("does not mark when the dispatch was skipped (Resend off)", async () => {
    const { service, mail, prisma } = build();
    mail.sendBillDueEmail.mockResolvedValue({
      provider: "resend",
      skipped: true,
      message: "Resend desabilitado por configuracao.",
    });

    expect(await service.sendDueReminders(baseUser, now)).toBe(false);
    expect(markedIds(prisma)).toEqual([]);
  });

  it("uses the user's LOCAL day for the window", async () => {
    // 02:00 UTC de 10-02 ainda e 23:00 de 10-01 em Sao Paulo (UTC-3)
    const early = new Date("2026-10-02T02:00:00.000Z");
    const sp = build([]);
    await sp.service.sendDueReminders({ ...baseUser, timezone: "America/Sao_Paulo" }, early);
    expect(sp.prisma.recurringTransaction.findMany.mock.calls[0][0].where.nextDueDate).toEqual({
      gt: day("2026-10-01"),
      lte: day("2026-10-04"),
    });

    const utc = build([]);
    await utc.service.sendDueReminders({ ...baseUser, timezone: "UTC" }, early);
    expect(utc.prisma.recurringTransaction.findMany.mock.calls[0][0].where.nextDueDate).toEqual({
      gt: day("2026-10-02"),
      lte: day("2026-10-05"),
    });
  });
});
