ALTER TABLE "User" ADD COLUMN "emailBillReminders" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "RecurringTransaction" ADD COLUMN "lastReminderForDate" TIMESTAMP(3);
