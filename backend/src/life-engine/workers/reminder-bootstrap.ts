import { ReminderStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { LifeEngineService } from "../life-engine.service";
import { getErrorMessage } from "./error-message";
import { workerLogger } from "./worker-logger";

export async function bootstrapPendingReminders(
  prisma: PrismaService,
  lifeEngineService: LifeEngineService,
) {
  const logger = workerLogger();

  try {
    const pending = await prisma.reminder.findMany({
      where: { status: ReminderStatus.SCHEDULED, remindAt: { gt: new Date() } },
      select: { id: true, remindAt: true },
    });

    for (const reminder of pending) {
      await lifeEngineService.scheduleReminder(reminder.id, reminder.remindAt);
    }

    if (pending.length > 0) {
      logger.log(`bootstrap_reminders count=${pending.length}`);
    }
  } catch (error) {
    logger.warn(`bootstrap_reminders_failed reason=${getErrorMessage(error)}`);
  }
}
