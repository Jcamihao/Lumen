// Mesma janela do insight de conta a vencer (UPCOMING_BILL_WINDOW_DAYS em
// insights.service.ts): se uma mudar, a outra precisa acompanhar.
export const BILL_REMINDER_WINDOW_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type BillReminderUser = {
  id: string;
  email: string;
  name?: string | null;
  timezone: string;
  preferredCurrency: string;
  emailVerifiedAt: Date | null;
  emailBillReminders: boolean;
};

export type BillCandidate = {
  id: string;
  description: string;
  amount: unknown;
  nextDueDate: Date;
  endDate: Date | null;
  lastReminderForDate: Date | null;
};

// Filtros em JS: endDate x nextDueDate compara dois campos da mesma linha
// (o Prisma nao faz isso no where) e lastReminderForDate pode ser nulo.
export function pendingBills(candidates: BillCandidate[]): BillCandidate[] {
  return candidates.filter(
    (bill) =>
      (!bill.endDate || bill.endDate.getTime() >= bill.nextDueDate.getTime()) &&
      bill.lastReminderForDate?.getTime() !== bill.nextDueDate.getTime(),
  );
}

export function toEmailBills(pending: BillCandidate[], userToday: Date) {
  return pending.map((bill) => ({
    description: bill.description,
    amount: Number(bill.amount),
    dueDate: bill.nextDueDate,
    daysUntil: Math.round(
      (bill.nextDueDate.getTime() - userToday.getTime()) / DAY_MS,
    ),
  }));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
