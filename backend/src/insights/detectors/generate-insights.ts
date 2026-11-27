import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { GeneratedInsight } from '../insight.types';
import { withPersona } from '../insight-identity';
import { detectBusyDay } from './busy-day.detector';
import { detectCategoryBudgets } from './category-budgets.detector';
import { detectCategoryShift } from './category-shift.detector';
import { detectCreditCycle } from './credit-cycle.detector';
import { detectDuplicateCharges } from './duplicate-charges.detector';
import { detectExpenseRatio } from './expense-ratio.detector';
import { detectGoalsBlockedByTasks } from './goals-blocked-by-tasks.detector';
import { detectOverdueFinancialCost } from './overdue-financial-cost.detector';
import { detectOverdueTasks } from './overdue-tasks.detector';
import { detectPrimaryGoalWithoutTracking } from './primary-goal-untracked.detector';
import { detectReceiptComparison } from './receipt-comparison.detector';
import { detectRecurringCharges } from './recurring-charges.detector';
import { detectRemindersToday } from './reminders-today.detector';
import { detectStalledGoals } from './stalled-goals.detector';
import { detectUpcomingBills } from './upcoming-bills.detector';
import { detectUpcomingBirthday } from './upcoming-birthday.detector';

type Detector = (context: InsightContext) => GeneratedInsight | null;

// A ordem importa: ela define a ordem em que os insights sao gravados.
const SINGLE_DETECTORS: Detector[] = [
  detectOverdueTasks,
  detectExpenseRatio,
  detectStalledGoals,
  detectBusyDay,
  detectRemindersToday,
  detectOverdueFinancialCost,
  detectGoalsBlockedByTasks,
  detectDuplicateCharges,
  detectRecurringCharges,
  detectReceiptComparison,
  detectUpcomingBirthday,
  detectPrimaryGoalWithoutTracking,
  detectCategoryShift,
];

const CALM_INSIGHT: GeneratedInsight = {
  type: InsightType.ROUTINE,
  key: 'calm',
  severity: InsightSeverity.INFO,
  message: 'Seu momento parece equilibrado: sem alertas relevantes agora, com espaco para focar no que acelera seus objetivos.',
};

/** Roda todos os detectores sobre o contexto e carimba a persona de cada insight. */
export function generateInsights(context: InsightContext): GeneratedInsight[] {
  const insights = SINGLE_DETECTORS.map((detect) => detect(context)).filter(
    (insight): insight is GeneratedInsight => insight !== null,
  );
  insights.push(...detectCategoryBudgets(context));
  for (const detect of [detectCreditCycle, detectUpcomingBills]) {
    const insight = detect(context);
    if (insight) insights.push(insight);
  }
  if (insights.length === 0) insights.push(CALM_INSIGHT);

  return insights.map(withPersona);
}
