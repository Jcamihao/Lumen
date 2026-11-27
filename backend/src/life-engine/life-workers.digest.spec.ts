import { NOW_MONDAY, eligibleUser, buildService } from "./life-workers.test-helpers";
import { resetWorkers, runPulse } from "./life-workers.worker-helpers";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation((queue: string, processor: unknown) => ({
    queue,
    processor,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe("LifeWorkersService: pulse scan", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW_MONDAY);
    resetWorkers();
  });

  afterEach(() => jest.useRealTimers());

  it("segunda-feira local com digest vencido envia resumo e avanca lastWeeklyDigestAt", async () => {
    const { deps, logs } = await runPulse(NOW_MONDAY, (d) => {
      d.prisma.user.findMany.mockResolvedValue([eligibleUser]);
      d.prisma.user.findUnique.mockResolvedValue(eligibleUser);
      d.billReminders.sendDueReminders.mockResolvedValue(true);
    });

    expect(deps.dashboard.getSummary.mock.calls).toMatchSnapshot();
    expect(deps.mail.sendWeeklyDigestEmail.mock.calls).toMatchSnapshot();
    expect(deps.prisma.user.update.mock.calls).toMatchSnapshot();
    expect(logs).toMatchSnapshot();
  });

  it("digest nao elegivel so avanca lastWeeklyDigestAt, sem email", async () => {
    const { deps } = await runPulse(NOW_MONDAY, (d) => {
      d.prisma.user.findMany.mockResolvedValue([eligibleUser]);
      d.prisma.user.findUnique.mockResolvedValue({ ...eligibleUser, emailWeeklyDigest: false });
    });

    expect(deps.mail.sendWeeklyDigestEmail).not.toHaveBeenCalled();
    expect(deps.prisma.user.update).toHaveBeenCalledTimes(1);
  });


  it.each([
    [5, 0],
    [6, 1],
  ])("ultimo digest ha %d dias: envia %d email(s) (limite de 6 dias)", async (daysAgo, sent) => {
    const lastWeeklyDigestAt = new Date(NOW_MONDAY.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const { deps } = await runPulse(NOW_MONDAY, (d) => {
      d.prisma.user.findMany.mockResolvedValue([{ ...eligibleUser, lastWeeklyDigestAt }]);
      d.prisma.user.findUnique.mockResolvedValue(eligibleUser);
    });

    expect(deps.mail.sendWeeklyDigestEmail).toHaveBeenCalledTimes(sent);
  });
});
