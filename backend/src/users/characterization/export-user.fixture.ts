import { Prisma } from "@prisma/client";

export const FIXED_NOW = new Date("2026-02-01T12:00:00.000Z");

const at = (iso: string) => new Date(iso);
const money = (value: string) => new Prisma.Decimal(value);

export function buildExportFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "Marina",
    email: "marina@example.com",
    avatarUrl: null,
    phone: "11999990000",
    birthDate: at("1990-05-10T00:00:00.000Z"),
    occupation: "Engenheira",
    primaryGoal: "Juntar reserva",
    role: "USER",
    preferredCurrency: "BRL",
    monthlyIncome: money("5000"),
    timezone: "America/Sao_Paulo",
    emailWeeklyDigest: true,
    emailReminders: true,
    emailInsightAlerts: false,
    emailBillReminders: true,
    emailVerifiedAt: at("2026-01-01T00:00:00.000Z"),
    lastLoginAt: at("2026-01-30T00:00:00.000Z"),
    createdAt: at("2025-12-01T00:00:00.000Z"),
    updatedAt: at("2026-01-30T00:00:00.000Z"),
    passwordHash: "hash-secreto",
    mfaTotpSecretEncrypted: "mfa-secreto",
    mfaPendingTotpSecretEncrypted: "mfa-pendente-secreto",
    mfaRecoveryCodes: [
      { hash: "rc-1", usedAt: null },
      { hash: "rc-2", usedAt: "2026-01-02T00:00:00.000Z" },
    ],
    mfaEnabledAt: at("2026-01-03T00:00:00.000Z"),
    mfaLastVerifiedAt: at("2026-01-04T00:00:00.000Z"),
    mfaLastTotpStep: 4321,
    privacyNoticeAcceptedAt: at("2026-01-01T00:00:00.000Z"),
    privacyNoticeVersion: "2026-03-26",
    aiAssistantEnabled: true,
    aiAssistantConsentAt: at("2026-01-01T00:00:00.000Z"),
    aiAssistantConsentVersion: "2026-03-26",
    taskCategories: [{ id: "tc-1", name: "Casa", color: "#000", icon: "home" }],
    financeCategories: [
      { id: "fc-1", name: "Moradia", type: "EXPENSE", budget: money("1500"), userId: "user-1" },
      { id: "fc-2", name: "Salario", type: "INCOME", budget: null, userId: "user-1" },
    ],
    tagGroups: [{ id: "tg-1", name: "Casa", sortOrder: 0 }],
    tasks: [
      { id: "t-1", title: "Pagar luz", estimatedAmount: money("180.5"), category: null, goal: null, subtasks: [] },
      { id: "t-2", title: "Revisar plano", estimatedAmount: null, category: null, goal: null, subtasks: [] },
    ],
    transactions: [
      { id: "tx-1", description: "Mercado", amount: money("42.5"), category: { id: "fc-1", name: "Moradia", color: "#f00", icon: "home", type: "EXPENSE", budget: null }, task: { id: "t-1", title: "Pagar luz" }, goal: null, date: at("2026-01-20T00:00:00.000Z") },
    ],
    goals: [
      { id: "g-1", title: "Reserva", targetAmount: money("10000"), currentAmount: money("2500") },
      { id: "g-2", title: "Viagem", targetAmount: null, currentAmount: money("0") },
    ],
    reminders: [{ id: "r-1", title: "Conta", remindAt: at("2026-02-05T00:00:00.000Z") }],
    insights: [{ id: "i-1", kind: "SPENDING", createdAt: at("2026-01-15T00:00:00.000Z") }],
    forecasts: [{ id: "f-1", referenceDate: at("2026-02-01T00:00:00.000Z"), predictedBalance: money("1200.75") }],
    importJobs: [{ id: "ij-1", status: "DONE", createdAt: at("2026-01-10T00:00:00.000Z") }],
    receiptScans: [
      {
        id: "rs-1", totalAmount: money("60"), subtotalAmount: null, taxAmount: money("3.2"), createdAt: at("2026-01-12T00:00:00.000Z"),
        items: [
          { id: "ri-1", sortOrder: 0, quantity: money("2"), unitPrice: null, totalPrice: money("40") },
          { id: "ri-2", sortOrder: 1, quantity: money("1"), unitPrice: money("20"), totalPrice: money("20") },
        ],
      },
      {
        id: "rs-2", totalAmount: money("55"), subtotalAmount: money("55"), taxAmount: null, createdAt: at("2026-01-13T00:00:00.000Z"),
        items: [{ id: "ri-3", sortOrder: 0, quantity: money("1"), unitPrice: money("55"), totalPrice: money("55") }],
      },
    ],
    notifications: [{ id: "n-1", title: "Oi", createdAt: at("2026-01-28T00:00:00.000Z") }],
    forecastSnapshots: [
      { id: "fs-1", targetDate: at("2026-02-10T00:00:00.000Z"), predictedBalance: money("1000"), actualBalance: money("900"), errorPercent: money("10") },
      { id: "fs-2", targetDate: at("2026-01-10T00:00:00.000Z"), predictedBalance: money("500"), actualBalance: null, errorPercent: null },
    ],
    recurringTransactions: [{ id: "rr-1", description: "Aluguel", amount: money("1200"), createdAt: at("2026-01-02T00:00:00.000Z") }],
    assistantTurns: [{ id: "at-1", question: "Como estou?", answer: "Bem.", createdAt: at("2026-01-29T00:00:00.000Z") }],
    supportRequests: [{ id: "sr-1", subject: "Ajuda", message: "Preciso de ajuda", createdAt: at("2026-01-25T00:00:00.000Z") }],
    authSessions: [
      { id: "s-1", userAgent: "Chrome", ipAddress: "10.0.0.1", lastUsedAt: null, expiresAt: at("2026-03-01T00:00:00.000Z"), revokedAt: null, revokeReason: null, createdAt: at("2026-01-01T00:00:00.000Z") },
    ],
    ...overrides,
  };
}
