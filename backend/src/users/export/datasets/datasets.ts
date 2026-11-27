import { toPrivacyCategoryExport } from "../../../finance-categories/finance-categories.service";
import { toPrivacyTransactionExport } from "../../../transactions/shared-transaction.view";
import { ExportableUser } from "../export-user.query";
import { mapForecasts, mapForecastSnapshots } from "./forecast-export";
import { mapGoals } from "./goal-export";
import { mapRecurring } from "./recurring-export";
import { mapReceiptScans } from "./receipt-scan-export";
import { mapTasks } from "./task-export";

function buildCoreDatasets(user: ExportableUser) {
  return {
    taskCategories: user.taskCategories,
    financeCategories: user.financeCategories.map(toPrivacyCategoryExport),
    tasks: mapTasks(user.tasks),
    transactions: user.transactions.map(toPrivacyTransactionExport),
    goals: mapGoals(user.goals),
    reminders: user.reminders,
    insights: user.insights,
    forecasts: mapForecasts(user.forecasts),
    importJobs: user.importJobs,
    receiptScans: mapReceiptScans(user.receiptScans),
    notifications: user.notifications,
    tagGroups: user.tagGroups,
  };
}

function buildHistoryDatasets(user: ExportableUser) {
  return {
    forecastSnapshots: mapForecastSnapshots(user.forecastSnapshots),
    recurringTransactions: mapRecurring(user.recurringTransactions),
    assistantTurns: user.assistantTurns,
    supportRequests: user.supportRequests,
    authSessions: user.authSessions,
  };
}

export function buildDatasets(user: ExportableUser) {
  return { ...buildCoreDatasets(user), ...buildHistoryDatasets(user) };
}
