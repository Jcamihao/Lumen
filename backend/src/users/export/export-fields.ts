import { omitKeys } from "../shared/omit-keys";
import { ExportableUser } from "./export-user.query";

const SECRET_FIELDS = [
  "passwordHash",
  "mfaTotpSecretEncrypted",
  "mfaPendingTotpSecretEncrypted",
  "mfaRecoveryCodes",
] as const;

const DATASET_FIELDS = [
  "taskCategories",
  "financeCategories",
  "tagGroups",
  "tasks",
  "transactions",
  "goals",
  "reminders",
  "insights",
  "forecasts",
  "importJobs",
  "receiptScans",
  "notifications",
  "forecastSnapshots",
  "recurringTransactions",
  "assistantTurns",
  "supportRequests",
  "authSessions",
] as const;

export function toAccountFields(user: ExportableUser) {
  return omitKeys(user, [...SECRET_FIELDS, ...DATASET_FIELDS]);
}
