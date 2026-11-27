import { Prisma } from "@prisma/client";
import { ForecastsService } from "./forecasts.service";

const LAST_DAY_OF_MONTH = new Date("2026-03-31T12:00:00.000Z");

function build(monthlyIncome: number | null, currentBalance: number) {
  const income = [{ type: "INCOME", amount: new Prisma.Decimal(currentBalance) }];
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ monthlyIncome }) },
    transaction: { findMany: jest.fn().mockResolvedValueOnce(income).mockResolvedValueOnce([]) },
    task: { findMany: jest.fn().mockResolvedValue([]) },
    forecast: { create: jest.fn(async ({ data }: any) => ({ id: "fc", ...data })) },
    forecastSnapshot: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new ForecastsService(prisma as any) };
}

describe("ForecastsService: limites de risco e consulta de snapshots", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(LAST_DAY_OF_MONTH));
  afterEach(() => jest.useRealTimers());

  it("saldo previsto de 26% da renda (acima do piso de 25%) e risco LOW", async () => {
    const { service } = build(1000, 260);

    expect((await service.recalculateForUser("u")).riskLevel).toBe("LOW");
  });

  it("saldo previsto de 24% da renda (abaixo do piso de 25%) e risco MEDIUM", async () => {
    const { service } = build(1000, 240);

    expect((await service.recalculateForUser("u")).riskLevel).toBe("MEDIUM");
  });

  it("sem renda e saldo previsto exatamente zero nao e HIGH", async () => {
    const { service } = build(null, 0);

    expect((await service.recalculateForUser("u")).riskLevel).toBe("LOW");
  });

  it("resolveMatureSnapshots busca snapshots com targetDate <= agora e nao resolvidos", async () => {
    const { prisma, service } = build(null, 0);
    await service.resolveMatureSnapshots("u");

    expect(prisma.forecastSnapshot.findMany).toHaveBeenCalledWith({
      where: { userId: "u", targetDate: { lte: LAST_DAY_OF_MONTH }, resolvedAt: null },
    });
  });
});
