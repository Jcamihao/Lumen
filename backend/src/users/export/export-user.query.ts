import { Prisma } from "@prisma/client";

const ACCOUNT_LISTS = {
  taskCategories: { orderBy: { name: "asc" } },
  financeCategories: { orderBy: [{ type: "asc" }, { name: "asc" }] },
  tagGroups: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
} satisfies Prisma.UserInclude;

const WORK_LISTS = {
  tasks: {
    include: {
      category: true,
      goal: true,
      subtasks: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  },
  transactions: {
    include: {
      category: true,
      task: { select: { id: true, title: true } },
      goal: { select: { id: true, title: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  },
} satisfies Prisma.UserInclude;

const PLANNING_LISTS = {
  goals: { orderBy: [{ status: "asc" }, { targetDate: "asc" }] },
  reminders: { orderBy: { remindAt: "asc" } },
  insights: { orderBy: { createdAt: "desc" } },
  forecasts: { orderBy: { referenceDate: "desc" } },
  importJobs: { orderBy: { createdAt: "desc" } },
  receiptScans: {
    include: { items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.UserInclude;

const ACTIVITY_LISTS = {
  notifications: { orderBy: { createdAt: "desc" } },
  forecastSnapshots: { orderBy: { targetDate: "desc" } },
  recurringTransactions: { orderBy: { createdAt: "desc" } },
  assistantTurns: { orderBy: { createdAt: "desc" } },
  supportRequests: { orderBy: { createdAt: "desc" } },
  // So metadados do dispositivo; o hash do refresh token nunca sai daqui.
  authSessions: {
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      revokeReason: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.UserInclude;

export const EXPORT_USER_INCLUDE = {
  ...ACCOUNT_LISTS,
  ...WORK_LISTS,
  ...PLANNING_LISTS,
  ...ACTIVITY_LISTS,
} satisfies Prisma.UserInclude;

export type ExportableUser = Prisma.UserGetPayload<{ include: typeof EXPORT_USER_INCLUDE }>;

export function exportUserQuery(userId: string) {
  return { where: { id: userId }, include: EXPORT_USER_INCLUDE };
}
