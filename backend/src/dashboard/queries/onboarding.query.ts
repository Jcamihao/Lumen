import { PrismaService } from '../../prisma/prisma.service';
import { resolveAll } from './resolve-all';

/**
 * Onboarding: so precisa saber se JA existe pelo menos um de cada (findFirst
 * e barato e usa os indices de userId).
 */
export function findOnboardingItems(prisma: PrismaService, userId: string) {
  return resolveAll({
    firstTask: prisma.task.findFirst({ where: { userId }, select: { id: true } }),
    // Lancamento gerado por conta fixa nao conta como "registrei um gasto".
    firstManualTransaction: prisma.transaction.findFirst({
      where: { userId, recurringTransactionId: null },
      select: { id: true },
    }),
    firstGoal: prisma.goal.findFirst({ where: { userId }, select: { id: true } }),
    firstRecurring: prisma.recurringTransaction.findFirst({ where: { userId }, select: { id: true } }),
    firstAssistantTurn: prisma.assistantTurn.findFirst({ where: { userId }, select: { id: true } }),
  });
}
