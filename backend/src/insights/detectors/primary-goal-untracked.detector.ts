import { InsightSeverity, InsightType } from '@prisma/client';
import { differenceInDays } from 'date-fns';
import { InsightContext } from '../context/insight-context.types';
import { GeneratedInsight } from '../insight.types';

const GRACE_DAYS = 3;
const MAX_GOAL_TEXT = 120;

/**
 * O usuario declarou um objetivo principal no cadastro/configuracoes mas
 * ainda nao criou nenhuma meta pra ele — sugere transformar a intencao em
 * algo com prazo e valor. So dispara depois de uma folga de 3 dias (evita
 * cutucar no primeiro acesso).
 */
export function detectPrimaryGoalWithoutTracking(context: InsightContext): GeneratedInsight | null {
  const { user, goals, now } = context;
  if (!user.primaryGoal?.trim() || goals.length > 0) return null;
  if (differenceInDays(now, user.createdAt) < GRACE_DAYS) return null;

  return {
    type: InsightType.GOAL,
    key: 'primary_goal_untracked',
    severity: InsightSeverity.WARNING,
    message: `Voce disse, no cadastro, que seu objetivo principal era "${user.primaryGoal.trim().slice(0, MAX_GOAL_TEXT)}" — ainda nao existe nenhuma meta cadastrada pra isso. Que tal transformar em uma meta com prazo e valor?`,
  };
}
