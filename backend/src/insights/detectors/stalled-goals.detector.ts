import { InsightSeverity, InsightType } from '@prisma/client';
import { differenceInDays } from 'date-fns';
import { InsightContext } from '../context/insight-context.types';
import { GeneratedInsight } from '../insight.types';

const STALLED_PROGRESS = 0.25;
const STALLED_DAYS_TO_TARGET = 60;

export function detectStalledGoals(context: InsightContext): GeneratedInsight | null {
  const { goals, now } = context;

  const stalledGoals = goals.filter((goal) => {
    // Meta sem alvo nao tem "progresso" pra ficar atras: nunca conta como estagnada.
    if (goal.targetAmount === null) return false;

    const targetAmount = Number(goal.targetAmount);
    const currentAmount = Number(goal.currentAmount);
    const progress = targetAmount > 0 ? currentAmount / targetAmount : 0;
    const daysToTarget = goal.targetDate ? differenceInDays(goal.targetDate, now) : null;

    return progress < STALLED_PROGRESS && daysToTarget !== null && daysToTarget <= STALLED_DAYS_TO_TARGET;
  });
  if (stalledGoals.length === 0) return null;

  return {
    type: InsightType.GOAL,
    key: 'stalled_goals',
    severity: InsightSeverity.WARNING,
    message: `${stalledGoals.length} meta(s) estao com pouco progresso para o prazo atual. Talvez seja hora de redistribuir esforco ou aporte.`,
    metadata: { stalledGoals: stalledGoals.map((goal) => goal.title) },
  };
}
