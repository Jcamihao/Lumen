import { Prisma } from "@prisma/client";
import { addDays, startOfDay } from "date-fns";
import { ForecastsService } from "./forecasts.service";

const NOW = new Date("2026-03-15T12:00:00.000Z");
const HORIZON = addDays(NOW, 30);
const TODAY_START = startOfDay(NOW);

function sanitize(value: unknown): unknown {
  if (value instanceof Date) {
    if (value.getTime() === NOW.getTime()) return "<now>";
    if (value.getTime() === HORIZON.getTime()) return "<horizon>";
    if (value.getTime() === TODAY_START.getTime()) return "<todayStart>";
    return value.toISOString();
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]));
  }
  return value;
}

const tx = (type: string, amount: number) => ({ type, amount: new Prisma.Decimal(amount) });

function buildPrisma(fixture: {
  monthlyIncome?: number | null;
  current?: unknown[];
  future?: unknown[];
  tasks?: unknown[];
}) {
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ monthlyIncome: fixture.monthlyIncome ?? null }),
    },
    transaction: { findMany: jest.fn() },
    task: { findMany: jest.fn().mockResolvedValue(fixture.tasks ?? []) },
    forecast: {
      create: jest.fn(async ({ data }: any) => ({ id: "fc-1", createdAt: NOW, ...data })),
    },
    forecastSnapshot: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.transaction.findMany
    .mockResolvedValueOnce(fixture.current ?? [])
    .mockResolvedValueOnce(fixture.future ?? []);
  return prisma;
}

async function recalc(fixture: Parameters<typeof buildPrisma>[0]) {
  const prisma = buildPrisma(fixture);
  const service = new ForecastsService(prisma as any);
  const result = await service.recalculateForUser("user-1");
  return { prisma, result };
}

describe("ForecastsService.recalculateForUser (caracterizacao)", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it.each([
    [
      "saldo positivo com custo de tarefa: LOW",
      { monthlyIncome: 3000, current: [tx("INCOME", 1000), tx("EXPENSE", 200)], future: [tx("EXPENSE", 100)],
        tasks: [{ estimatedAmount: new Prisma.Decimal("75.5") }] },
    ],
    [
      "exposicao >= renda: HIGH",
      { monthlyIncome: 1000, current: [tx("INCOME", 2000)], future: [tx("EXPENSE", 1200)] },
    ],
    [
      "saldo previsto negativo: HIGH",
      { monthlyIncome: 0, current: [tx("EXPENSE", 100)], future: [] },
    ],
    [
      "saldo previsto abaixo de 25% da renda: MEDIUM",
      { monthlyIncome: 1000, current: [], future: [tx("EXPENSE", 400)] },
    ],
    [
      "exposicao entre 60% e 100% da renda: MEDIUM",
      { monthlyIncome: 1000, current: [tx("INCOME", 2000)], future: [tx("EXPENSE", 700)] },
    ],
    [
      "renda zero nao projeta renda e so olha o saldo: LOW",
      { monthlyIncome: null, current: [tx("INCOME", 100)], future: [] },
    ],
  ])("%s", async (_title, fixture) => {
    const { prisma, result } = await recalc(fixture);

    expect(sanitize(result)).toMatchSnapshot();
    expect(sanitize(prisma.forecast.create.mock.calls)).toMatchSnapshot();
    expect(sanitize(prisma.forecastSnapshot.create.mock.calls)).toMatchSnapshot();
  });

  it("consultas: usuario, transacoes passadas, futuras no horizonte e tarefas com custo", async () => {
    const { prisma } = await recalc({ monthlyIncome: 3000 });

    expect(sanitize(prisma.user.findUniqueOrThrow.mock.calls)).toMatchSnapshot();
    expect(sanitize(prisma.transaction.findMany.mock.calls)).toMatchSnapshot();
    expect(sanitize(prisma.task.findMany.mock.calls)).toMatchSnapshot();
  });

  it.each([
    [599, "LOW"],
    [600, "MEDIUM"],
    [999, "MEDIUM"],
    [1000, "HIGH"],
  ])("exposicao de %d com renda 1000 classifica como %s (fronteiras)", async (futureExpense, risk) => {
    const { result } = await recalc({
      monthlyIncome: 1000,
      current: [tx("INCOME", 2000)],
      future: [tx("EXPENSE", futureExpense)],
    });

    expect(result.riskLevel).toBe(risk);
  });
});
