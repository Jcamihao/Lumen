import { LifeWorkersService } from "./life-workers.service";

export const NOW_MONDAY = new Date("2026-03-02T10:00:00.000Z");
export const NOW_SUNDAY_DAY_ONE = new Date("2026-03-01T10:00:00.000Z");
export const REDIS_CONNECTION = { host: "redis-fake" };
export const UNSUBSCRIBE = { pageUrl: "https://app/unsub", oneClickUrl: "https://api/unsub" };

export const eligibleUser = {
  id: "user-1",
  email: "marina@exemplo.com",
  name: "Marina Souza",
  timezone: "America/Sao_Paulo",
  preferredCurrency: "BRL",
  lastWeeklyDigestAt: null as Date | null,
  emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  emailReminders: true,
  emailWeeklyDigest: true,
  emailInsightAlerts: true,
  emailBillReminders: true,
};

function prismaFake() {
  return {
    reminder: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    insight: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    goal: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    transaction: { create: jest.fn().mockResolvedValue({}) },
  };
}

function domainFakes() {
  return {
    insights: {
      refreshForUser: jest.fn().mockResolvedValue(undefined),
      takePendingNotifications: jest.fn().mockResolvedValue([]),
    },
    forecasts: {
      recalculateForUser: jest.fn().mockResolvedValue({ riskLevel: "LOW" }),
      resolveMatureSnapshots: jest.fn().mockResolvedValue(0),
    },
    notifications: { createNotification: jest.fn().mockResolvedValue({}) },
    mail: {
      sendReminderEmail: jest.fn().mockResolvedValue({}),
      sendWeeklyDigestEmail: jest.fn().mockResolvedValue({}),
      sendInsightEscalationEmail: jest.fn().mockResolvedValue({}),
    },
  };
}

function engineFakes() {
  return {
    lifeEngine: {
      schedulePulseScan: jest.fn().mockResolvedValue(undefined),
      scheduleReminder: jest.fn().mockResolvedValue(undefined),
      touchUserData: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function summaryFakes() {
  return {
    dashboard: {
      getSummary: jest.fn().mockResolvedValue({
        user: { name: "Marina Souza", preferredCurrency: "BRL" },
        tasks: { overdueCount: 2 },
        finances: { balance: 1000, monthlyExpenses: 500, monthlyIncome: 3000 },
        goals: [{ title: "Viagem", currentAmount: 300, targetAmount: 1000 }],
      }),
    },
  };
}

function infraFakes() {
  return {
    cacheQueue: {
      isReady: jest.fn(() => true),
      getQueueConnection: jest.fn(() => REDIS_CONNECTION),
    },
    config: { get: jest.fn((_key: string, fallback: unknown) => fallback) },
    emailPreferences: { buildUnsubscribeLinks: jest.fn(() => UNSUBSCRIBE) },
    recurring: { materializeDue: jest.fn().mockResolvedValue(0) },
    installments: { materializeDue: jest.fn().mockResolvedValue(0) },
    billReminders: { sendDueReminders: jest.fn().mockResolvedValue(false) },
  };
}

export function buildDeps() {
  return { ...infraFakes(), ...domainFakes(), ...engineFakes(), ...summaryFakes(), prisma: prismaFake() };
}

export type Deps = ReturnType<typeof buildDeps>;

export function buildService(deps: Deps = buildDeps()) {
  const d: any = deps;
  const service = new LifeWorkersService(
    d.cacheQueue, d.prisma, d.insights, d.forecasts, d.notifications, d.mail, d.lifeEngine,
    d.config, d.dashboard, d.emailPreferences, d.recurring, d.installments, d.billReminders,
  );
  return { service, deps };
}
