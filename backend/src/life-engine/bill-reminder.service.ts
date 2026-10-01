import { Injectable, Logger } from "@nestjs/common";
import { TransactionType } from "@prisma/client";
import { canSendAutomatedEmail } from "../email-preferences/email-categories";
import { EmailPreferencesService } from "../email-preferences/email-preferences.service";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  addDaysUtc,
  localToday,
} from "../recurring-transactions/recurrence.util";

// Mesma janela do insight de conta a vencer (UPCOMING_BILL_WINDOW_DAYS em
// insights.service.ts): se uma mudar, a outra precisa acompanhar.
const BILL_REMINDER_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

type BillReminderUser = {
  id: string;
  email: string;
  name?: string | null;
  timezone: string;
  preferredCurrency: string;
  emailVerifiedAt: Date | null;
  emailBillReminders: boolean;
};

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
    const windowEnd = addDaysUtc(userToday, BILL_REMINDER_WINDOW_DAYS);

    const candidates = await this.prisma.recurringTransaction.findMany({
      where: {
        userId: user.id,
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

    // Filtros em JS: endDate x nextDueDate compara dois campos da mesma linha
    // (o Prisma nao faz isso no where) e lastReminderForDate pode ser nulo.
    const pending = candidates.filter(
      (bill) =>
        (!bill.endDate || bill.endDate.getTime() >= bill.nextDueDate.getTime()) &&
        bill.lastReminderForDate?.getTime() !== bill.nextDueDate.getTime(),
    );

    if (pending.length === 0) return false;

    // Sem elegibilidade nao envia e nao marca: se o usuario confirmar o e-mail
    // ou religar a categoria enquanto a conta ainda esta na janela, ela sai.
    if (!canSendAutomatedEmail(user, "bill_due")) return false;

    try {
      const result = await this.mailService.sendBillDueEmail({
        email: user.email,
        name: user.name,
        preferredCurrency: user.preferredCurrency,
        bills: pending.map((bill) => ({
          description: bill.description,
          amount: Number(bill.amount),
          dueDate: bill.nextDueDate,
          daysUntil: Math.round(
            (bill.nextDueDate.getTime() - userToday.getTime()) / DAY_MS,
          ),
        })),
        unsubscribe: this.emailPreferencesService.buildUnsubscribeLinks(
          user.id,
          "bill_due",
        ),
      });

      // Resend desligado/mal configurado nao lanca: devolve skipped=true. Nao
      // marcar nesse caso, senao a conta nunca mais seria avisada.
      if (result.skipped) return false;
    } catch (error) {
      this.logger.warn(
        `bill_due_email_failed userId=${user.id} reason=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }

    for (const bill of pending) {
      await this.prisma.recurringTransaction.update({
        where: { id: bill.id },
        data: { lastReminderForDate: bill.nextDueDate },
      });
    }

    return true;
  }
}
