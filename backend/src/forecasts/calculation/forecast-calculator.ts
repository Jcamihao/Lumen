import { getDaysInMonth } from "date-fns";
import { ForecastInputs } from "./forecast-inputs";
import { classifyRisk } from "./risk-level";
import { sumSignedAmounts } from "./signed-amount";

function projectMonthlyIncome(monthlyIncome: number, now: Date) {
  const daysInMonth = getDaysInMonth(now);
  const remainingDays = daysInMonth - now.getDate();
  const projectedMonthlyIncome =
    monthlyIncome > 0 ? (monthlyIncome / daysInMonth) * remainingDays : 0;

  return { remainingDays, projectedMonthlyIncome };
}

export function calculateForecast(
  { user, currentTransactions, futureTransactions, pendingCostTasks }: ForecastInputs,
  now: Date,
) {
  const currentBalance = sumSignedAmounts(currentTransactions);
  const futureCashFlow = sumSignedAmounts(futureTransactions);
  const taskCosts = pendingCostTasks.reduce(
    (total, task) => total + Number(task.estimatedAmount ?? 0),
    0,
  );
  const monthlyIncome = Number(user.monthlyIncome ?? 0);
  const { remainingDays, projectedMonthlyIncome } = projectMonthlyIncome(monthlyIncome, now);

  const predictedBalance =
    currentBalance + futureCashFlow - taskCosts + projectedMonthlyIncome;
  const exposure = Math.abs(futureCashFlow) + taskCosts;
  const factors = {
    currentBalance,
    futureCashFlow,
    taskCosts,
    monthlyIncome,
    projectedMonthlyIncome,
    remainingDays,
  };

  return {
    predictedBalance,
    riskLevel: classifyRisk(predictedBalance, exposure, monthlyIncome),
    factors,
  };
}

export type ForecastCalculation = ReturnType<typeof calculateForecast>;
