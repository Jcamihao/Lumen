import { NotificationType, ReminderStatus } from "@prisma/client";
import type { Job } from "bullmq";
import { canSendAutomatedEmail } from "../../email-preferences/email-categories";
import { EmailPreferencesService } from "../../email-preferences/email-preferences.service";
import { MailService } from "../../mail/mail.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";
import { getErrorMessage } from "./error-message";
import { workerLogger } from "./worker-logger";

type ReminderWithRelations = {
  id: string;
  userId: string;
  title: string;
  remindAt: Date;
  status: ReminderStatus;
  user: {
    email: string;
    name: string;
    timezone: string;
    emailVerifiedAt: Date | null;
    emailReminders: boolean;
  };
  task: { title: string } | null;
  transaction: { description: string } | null;
  goal: { title: string } | null;
};

function relatedTitleOf(reminder: ReminderWithRelations) {
  return (
    reminder.task?.title ?? reminder.transaction?.description ?? reminder.goal?.title
  );
}

function reminderMessage(title: string, relatedTitle: string | null | undefined) {
  return relatedTitle
    ? `Lembrete disparado: ${title}. Contexto: ${relatedTitle}.`
    : `Lembrete disparado: ${title}.`;
}

export class ReminderDispatchProcessor {
  private readonly logger = workerLogger();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly emailPreferencesService: EmailPreferencesService,
  ) {}

  async dispatch(job: Job) {
    const reminder = await this.findScheduledReminder(String(job.data.reminderId));
    if (!reminder) return;

    await this.prisma.reminder.update({
      where: { id: reminder.id },
      data: { status: ReminderStatus.SENT, sentAt: new Date() },
    });

    const relatedTitle = relatedTitleOf(reminder);
    await this.notificationsService.createNotification(
      reminder.userId,
      NotificationType.REMINDER,
      reminder.title,
      reminderMessage(reminder.title, relatedTitle),
    );

    await this.sendEmailSafely(reminder, relatedTitle);
  }

  private async findScheduledReminder(
    reminderId: string,
  ): Promise<ReminderWithRelations | null> {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id: reminderId },
      include: {
        user: {
          select: {
            email: true,
            name: true,
            timezone: true,
            emailVerifiedAt: true,
            emailReminders: true,
          },
        },
        task: true,
        transaction: true,
        goal: true,
      },
    });

    return reminder?.status === ReminderStatus.SCHEDULED ? reminder : null;
  }

  private async sendEmailSafely(
    reminder: ReminderWithRelations,
    relatedTitle: string | null | undefined,
  ) {
    try {
      if (!canSendAutomatedEmail(reminder.user, "reminders")) return;

      await this.mailService.sendReminderEmail({
        email: reminder.user.email,
        name: reminder.user.name,
        title: reminder.title,
        contextTitle: relatedTitle,
        remindAt: reminder.remindAt,
        timezone: reminder.user.timezone,
        unsubscribe: this.emailPreferencesService.buildUnsubscribeLinks(
          reminder.userId,
          "reminders",
        ),
      });
    } catch (error) {
      this.logger.warn(
        `reminder_email_failed reminderId=${reminder.id} userId=${reminder.userId} reason=${getErrorMessage(error)}`,
      );
    }
  }
}
