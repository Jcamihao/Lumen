import { Injectable, Logger } from "@nestjs/common";
import { TransactionType } from "@prisma/client";
import { canSendAutomatedEmail } from "../email-preferences/email-categories";
import { EmailPreferencesService } from "../email-preferences/email-preferences.service";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  BILL_REMINDER_WINDOW_DAYS,
  BillCandidate,
  BillReminderUser,
  errorMessage,
  pendingBills,
  toEmailBills,
} from "./bill-reminder.rules";
import {
  addDaysUtc,
  localToday,
} from "../recurring-transactions/recurrence.util";

/**
 * Aviso por e-mail de conta fixa (despesa) que vence nos proximos dias.
 * Chamado pelo pulso diario (so na hora local alvo de cada usuario) — um
 * e-mail por usuario com todas as contas da janela, e cada conta so e
 * avisada uma vez por vencimento (lastReminderForDate).
 */
@Injectable()
export class BillReminderService {
  private readonly logger = new Logger(BillReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly emailPreferencesService: EmailPreferencesService,
  ) {}

  /** Devolve true se o e-mail foi realmente enviado. */
  async sendDueReminders(
    user: BillReminderUser,
    now = new Date(),
  ): Promise<boolean> {
    const userToday = localToday(now, user.timezone);
    const pending = pendingBills(
      await this.findBillCandidates(user.id, userToday),
    );

    if (pending.length === 0) return false;

    // Sem elegibilidade nao envia e nao marca: se o usuario confirmar o e-mail
    // ou religar a categoria enquanto a conta ainda esta na janela, ela sai.
    if (!canSendAutomatedEmail(user, "bill_due")) return false;

    if (!(await this.dispatchBillEmail(user, pending, userToday))) return false;

    await this.markReminded(pending);
    return true;
  }

  private async findBillCandidates(
    userId: string,
    userToday: Date,
  ): Promise<BillCandidate[]> {
    const windowEnd = addDaysUtc(userToday, BILL_REMINDER_WINDOW_DAYS);
    return this.prisma.recurringTransaction.findMany({
      where: {
        userId,
        type: TransactionType.EXPENSE,
        isActive: true,
        nextDueDate: { gt: userToday, lte: windowEnd },
      },
      orderBy: { nextDueDate: "asc" },
      select: {
        id: true,
        description: true,
        amount: true,
        nextDueDate: true,
        endDate: true,
        lastReminderForDate: true,
      },
    });
  }

  /** Devolve true se o e-mail foi enviado; falha vira aviso no log. */
  private async dispatchBillEmail(
    user: BillReminderUser,
    pending: BillCandidate[],
    userToday: Date,
  ): Promise<boolean> {
    try {
      const result = await this.mailService.sendBillDueEmail({
        email: user.email,
        name: user.name,
        preferredCurrency: user.preferredCurrency,
        bills: toEmailBills(pending, userToday),
        unsubscribe: this.emailPreferencesService.buildUnsubscribeLinks(
          user.id,
          "bill_due",
        ),
      });

      // Resend desligado/mal configurado nao lanca: devolve skipped=true. Nao
      // marcar nesse caso, senao a conta nunca mais seria avisada.
      return !result.skipped;
    } catch (error) {
      this.logger.warn(
        `bill_due_email_failed userId=${user.id} reason=${errorMessage(error)}`,
      );
      return false;
    }
  }

  private async markReminded(pending: BillCandidate[]): Promise<void> {
    for (const bill of pending) {
      await this.prisma.recurringTransaction.update({
        where: { id: bill.id },
        data: { lastReminderForDate: bill.nextDueDate },
      });
    }
  }
}
