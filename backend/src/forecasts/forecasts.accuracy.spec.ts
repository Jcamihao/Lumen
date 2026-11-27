import { Prisma } from "@prisma/client";
import { ForecastsService } from "./forecasts.service";

const NOW = new Date("2026-03-15T12:00:00.000Z");

describe("ForecastsService: conferencia de snapshots (caracterizacao)", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  function build(due: unknown[], transactions: unknown[] = []) {
    const prisma = {
      forecastSnapshot: {
        findMany: jest.fn().mockResolvedValue(due),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      transaction: { findMany: jest.fn().mockResolvedValue(transactions) },
    };
    return { prisma, service: new ForecastsService(prisma as any) };
  }

  it("nenhum snapshot vencido: retorna 0 sem consultar saldo", async () => {
    const { prisma, service } = build([]);

    expect(await service.resolveMatureSnapshots("user-1")).toBe(0);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it("calcula erro percentual com saldo real e grava resolvedAt", async () => {
    const due = [
      { id: "s-1", predictedBalance: new Prisma.Decimal("1000") },
      { id: "s-2", predictedBalance: new Prisma.Decimal("0") },
      { id: "s-3", predictedBalance: new Prisma.Decimal("-200") },
    ];
    const { prisma, service } = build(due, [
      { type: "INCOME", amount: new Prisma.Decimal("1200") },
      { type: "EXPENSE", amount: new Prisma.Decimal("100") },
    ]);

    expect(await service.resolveMatureSnapshots("user-1")).toBe(3);

    expect(prisma.transaction.findMany.mock.calls).toMatchSnapshot();
    expect(prisma.forecastSnapshot.update.mock.calls).toMatchSnapshot();
  });

  it("predito zero com real zero da erro 0; predito zero com real diferente de zero da 100", async () => {
    const { prisma, service } = build([{ id: "s-z", predictedBalance: 0 }], []);
    await service.resolveMatureSnapshots("user-1");
    expect(prisma.forecastSnapshot.update.mock.calls[0][0].data.errorPercent).toBe(0);

    const other = build([{ id: "s-y", predictedBalance: 0 }], [{ type: "INCOME", amount: 5 }]);
    await other.service.resolveMatureSnapshots("user-1");
    expect(other.prisma.forecastSnapshot.update.mock.calls[0][0].data.errorPercent).toBe(100);
  });

  it("getLatestAccuracy: null sem snapshot conferido; mapeia campos quando existe", async () => {
    const { prisma, service } = build([]);
    expect(await service.getLatestAccuracy("user-1")).toBeNull();

    prisma.forecastSnapshot.findFirst.mockResolvedValue({
      targetDate: new Date("2026-03-10T00:00:00.000Z"),
      predictedBalance: new Prisma.Decimal("900"),
      actualBalance: new Prisma.Decimal("1000"),
      errorPercent: new Prisma.Decimal("11.11"),
      resolvedAt: NOW,
    });
    const accuracy = await service.getLatestAccuracy("user-1");
    expect(accuracy).toMatchSnapshot();
    expect(prisma.forecastSnapshot.findFirst.mock.calls).toMatchSnapshot();
  });
});
