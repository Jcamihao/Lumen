import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { GeneratedInsight } from '../insight.types';

export function detectRemindersToday(context: InsightContext): GeneratedInsight | null {
  const { remindersToday } = context;
  if (remindersToday.length === 0) return null;

  return {
    type: InsightType.ROUTINE,
    key: 'reminders_today',
    severity: InsightSeverity.INFO,
    message: `Existem ${remindersToday.length} lembrete(s) programados para hoje. Bom dia para operar no modo checklist.`,
    metadata: { remindersToday: remindersToday.length },
  };
}
