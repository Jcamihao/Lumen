import { ExportableUser } from "../export-user.query";

export function mapRecurring(items: ExportableUser["recurringTransactions"]) {
  return items.map((item) => ({ ...item, amount: Number(item.amount) }));
}
