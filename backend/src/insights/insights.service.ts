import { Injectable } from '@nestjs/common';
import { InsightSeverity, InsightType, Prisma } from '@prisma/client';
import { differenceInDays, endOfDay, startOfDay, startOfMonth } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';

type GeneratedInsight = {
  type: InsightType;
  severity: InsightSeverity;
  message: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const existingInsights = await this.prisma.insight.findMany({
      where: { userId },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    });

    if (existingInsights.length > 0) {
      return existingInsights;
    }

    return this.refreshForUser(userId);
  }

  async refreshForUser(userId: string) {
    const generatedInsights = await this.generateInsights(userId);

    await this.prisma.$transaction([
      this.prisma.insight.deleteMany({
        where: { userId },
      }),
      this.prisma.insight.createMany({
        data: generatedInsights.map((insight) => ({
          userId,
          type: insight.type,
          severity: insight.severity,
          message: insight.message,
          metadata: insight.metadata as Prisma.InputJsonValue | undefined,
        })),
      }),
    ]);

    return this.prisma.insight.findMany({
      where: { userId },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    });
  }

  private async generateInsights(userId: string): Promise<GeneratedInsight[]> {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = startOfMonth(now);

    const [user, overdueTasks, tasksToday, monthlyExpensesAggregate, goals, remindersToday] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
        }),
        this.prisma.task.findMany({
          where: {
            userId,
            status: {
              in: ['PENDING', 'IN_PROGRESS'],
            },
            dueDate: {
              lt: todayStart,
            },
          },
        }),
        this.prisma.task.findMany({
          where: {
            userId,
            dueDate: {
              gte: todayStart,
              lte: todayEnd,
            },
            status: {
              in: ['PENDING', 'IN_PROGRESS'],
            },
          },
        }),
        this.prisma.transaction.aggregate({
          where: {
            userId,
            type: 'EXPENSE',
            date: {
              gte: monthStart,
              lte: now,
            },
          },
          _sum: {
            amount: true,
          },
        }),
        this.prisma.goal.findMany({
          where: {
            userId,
            status: {
              in: ['ACTIVE', 'PLANNED'],
            },
          },
        }),
        this.prisma.reminder.findMany({
          where: {
            userId,
            remindAt: {
              gte: todayStart,
              lte: todayEnd,
            },
          },
        }),
      ]);

    const insights: GeneratedInsight[] = [];
    const monthlyExpenses = Number(monthlyExpensesAggregate._sum.amount ?? 0);
    const monthlyIncome = Number(user.monthlyIncome ?? 0);

    if (overdueTasks.length > 0) {
      insights.push({
        type: InsightType.PRODUCTIVITY,
        severity:
          overdueTasks.length >= 3 ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
        message:
          overdueTasks.length >= 3
            ? `Voce tem ${overdueTasks.length} tarefas atrasadas. Vale limpar essa fila hoje para recuperar tracao.`
            : `Existe ${overdueTasks.length} tarefa atrasada. Resolver isso cedo tende a aliviar a semana.`,
        metadata: {
          overdueTasks: overdueTasks.length,
        },
      });
    }

    if (monthlyIncome > 0 && monthlyExpenses >= monthlyIncome * 0.85) {
      insights.push({
        type: InsightType.FINANCE,
        severity:
          monthlyExpenses >= monthlyIncome ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
        message:
          monthlyExpenses >= monthlyIncome
            ? 'Suas despesas do mes ja encostaram na sua renda. Vale frear gastos variaveis e revisar contas futuras.'
            : 'Suas despesas do mes ja passaram de 85% da sua renda. Um ajuste leve agora reduz risco no fechamento.',
        metadata: {
          monthlyExpenses,
          monthlyIncome,
        },
      });
    }

    const stalledGoals = goals.filter((goal) => {
      const targetAmount = Number(goal.targetAmount);
      const currentAmount = Number(goal.currentAmount);
      const progress = targetAmount > 0 ? currentAmount / targetAmount : 0;
      const daysToTarget = goal.targetDate ? differenceInDays(goal.targetDate, now) : null;

      return progress < 0.25 && daysToTarget !== null && daysToTarget <= 60;
    });

    if (stalledGoals.length > 0) {
      insights.push({
        type: InsightType.GOAL,
        severity: InsightSeverity.WARNING,
        message: `${stalledGoals.length} meta(s) estao com pouco progresso para o prazo atual. Talvez seja hora de redistribuir esforco ou aporte.`,
        metadata: {
          stalledGoals: stalledGoals.map((goal) => goal.title),
        },
      });
    }

    if (tasksToday.length >= 4) {
      insights.push({
        type: InsightType.ROUTINE,
        severity: InsightSeverity.INFO,
        message: `Hoje voce tem ${tasksToday.length} compromissos ativos. Priorize os de maior impacto financeiro e os que destravam outras frentes.`,
        metadata: {
          tasksToday: tasksToday.length,
        },
      });
    }

    if (remindersToday.length > 0) {
      insights.push({
        type: InsightType.ROUTINE,
        severity: InsightSeverity.INFO,
        message: `Existem ${remindersToday.length} lembrete(s) programados para hoje. Bom dia para operar no modo checklist.`,
        metadata: {
          remindersToday: remindersToday.length,
        },
      });
    }

    if (insights.length === 0) {
      insights.push({
        type: InsightType.ROUTINE,
        severity: InsightSeverity.INFO,
        message: 'Seu momento parece equilibrado: sem alertas relevantes agora, com espaco para focar no que acelera seus objetivos.',
      });
    }

    return insights;
  }
}
