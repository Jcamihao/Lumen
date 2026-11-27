import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { GeneratedInsight } from '../insight.types';
import { hashSubject } from '../insight-identity';

const MIN_OVERDUE_TASKS = 2;

/**
 * Meta que nao anda por causa de tarefa, nao de dinheiro.
 *
 * detectStalledGoals olha so o progresso e sugere "redistribuir esforco" sem
 * saber o porque. Aqui o vinculo Task.linkedGoalId responde a causa.
 */
export function detectGoalsBlockedByTasks(context: InsightContext): GeneratedInsight | null {
  const blocked = context.goals
    .map((goal) => ({
      goal,
      overdue: context.overdueTasks.filter((task) => task.linkedGoalId === goal.id),
    }))
    .filter((entry) => entry.overdue.length >= MIN_OVERDUE_TASKS)
    .sort((a, b) => b.overdue.length - a.overdue.length);
  if (blocked.length === 0) return null;

  const worst = blocked[0];
  return {
    type: InsightType.GOAL,
    key: `goals_blocked_by_tasks:${hashSubject(blocked.map((entry) => entry.goal.id))}`,
    severity: InsightSeverity.WARNING,
    message:
      blocked.length === 1
        ? `A meta ${worst.goal.title} esta parada por tarefa, nao por dinheiro: ${worst.overdue.length} tarefas ligadas a ela estao atrasadas.`
        : `${blocked.length} metas estao travadas por tarefas atrasadas, a comecar por ${worst.goal.title} com ${worst.overdue.length} pendencias.`,
    metadata: {
      blockedGoals: blocked.map((entry) => ({
        id: entry.goal.id,
        title: entry.goal.title,
        overdueTasks: entry.overdue.length,
      })),
    },
  };
}
