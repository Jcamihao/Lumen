import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { GeneratedInsight } from '../insight.types';

const CRITICAL_OVERDUE_COUNT = 3;

export function detectOverdueTasks(context: InsightContext): GeneratedInsight | null {
  const { overdueTasks } = context;
  if (overdueTasks.length === 0) return null;

  const critical = overdueTasks.length >= CRITICAL_OVERDUE_COUNT;
  return {
    type: InsightType.PRODUCTIVITY,
    key: 'overdue_tasks',
    severity: critical ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
    message: critical
      ? `Voce tem ${overdueTasks.length} tarefas atrasadas. Vale limpar essa fila hoje para recuperar tracao.`
      : `Existe ${overdueTasks.length} tarefa atrasada. Resolver isso cedo tende a aliviar a semana.`,
    metadata: { overdueTasks: overdueTasks.length },
  };
}
