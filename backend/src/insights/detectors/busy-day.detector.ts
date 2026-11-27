import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { GeneratedInsight } from '../insight.types';

const BUSY_DAY_MIN_TASKS = 4;

export function detectBusyDay(context: InsightContext): GeneratedInsight | null {
  const { tasksToday } = context;
  if (tasksToday.length < BUSY_DAY_MIN_TASKS) return null;

  return {
    type: InsightType.ROUTINE,
    key: 'busy_day',
    severity: InsightSeverity.INFO,
    message: `Hoje voce tem ${tasksToday.length} compromissos ativos. Priorize os de maior impacto financeiro e os que destravam outras frentes.`,
    metadata: { tasksToday: tasksToday.length },
  };
}
