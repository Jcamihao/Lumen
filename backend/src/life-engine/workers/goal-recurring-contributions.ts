import { Goal, GoalStatus, NotificationType, Prisma, TransactionType } from "@prisma/client";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";
import { localDayOfMonthFor } from "./local-time";
import { workerLogger } from "./worker-logger";

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * Aporte automatico de metas — mesma mecanica do contribute() manual
 * (GoalsService), so que disparada pelo relogio (dia do mes configurado
 * em recurringDay) em vez de um clique. Nao chama GoalsService direto pra
 * evitar dependencia circular de modulo (GoalsModule ja importa
 * LifeEngineModule).
 */
export class GoalRecurringContributions {
  private readonly logger = workerLogger();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async contributeDue(userId: string, timezone: string, preferredCurrency: string): Promise<number> {
    const day = localDayOfMonthFor(timezone);
    if (day < 1) return 0;

    const dueGoals = await this.prisma.goal.findMany({
      where: {
        userId,
        status: GoalStatus.ACTIVE,
        recurringAmount: { not: null },
        recurringDay: day,
      },
    });

    for (const goal of dueGoals) {
      await this.contribute(goal, userId, preferredCurrency);
    }

    return dueGoals.length;
  }

  private async contribute(goal: Goal, userId: string, preferredCurrency: string) {
    const amount = Number(goal.recurringAmount);
    const nextCurrentAmount = Number(goal.currentAmount) + amount;
    const nextStatus = this.nextStatus(goal, nextCurrentAmount);

    await this.persistContribution(goal, userId, amount, nextCurrentAmount, nextStatus);
    await this.notifyContribution(userId, goal, amount, nextStatus, preferredCurrency);

    this.logger.log(
      `goal_recurring_contribution goalId=${goal.id} userId=${userId} amount=${amount}`,
    );
  }

  private async persistContribution(
    goal: Goal,
    userId: string,
    amount: number,
    nextCurrentAmount: number,
    nextStatus: GoalStatus,
  ) {
    await this.prisma.goal.update({
      where: { id: goal.id },
      data: { currentAmount: new Prisma.Decimal(nextCurrentAmount), status: nextStatus },
    });

    await this.prisma.transaction.create({
      data: {
        userId,
        type: TransactionType.TRANSFER,
        description: `Aporte automático para a meta ${goal.title}`,
        amount: new Prisma.Decimal(amount),
        date: new Date(),
        linkedGoalId: goal.id,
      },
    });
  }

  // Meta sem alvo (cofrinho sem proposito) nunca vira ACHIEVED sozinha.
  private nextStatus(goal: Goal, nextCurrentAmount: number): GoalStatus {
    const reachesTarget =
      goal.targetAmount !== null && nextCurrentAmount >= Number(goal.targetAmount);

    return reachesTarget ? GoalStatus.ACHIEVED : goal.status;
  }

  private async notifyContribution(
    userId: string,
    goal: Goal,
    amount: number,
    status: GoalStatus,
    currency: string,
  ) {
    const formattedAmount = formatCurrency(amount, currency);
    const achieved = status === GoalStatus.ACHIEVED;

    await this.notificationsService.createNotification(
      userId,
      NotificationType.SYSTEM,
      achieved ? "Meta concluída" : "Aporte automático realizado",
      achieved
        ? `O aporte automático de ${formattedAmount} concluiu a meta "${goal.title}".`
        : `Aporte automático de ${formattedAmount} aplicado na meta "${goal.title}".`,
    );
  }
}
