import { getDaysInMonth } from "date-fns";
import { ForecastInputs } from "./forecast-inputs";
import { classifyRisk } from "./risk-level";
import { sumSignedAmounts } from "./signed-amount";

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
  const daysInMonth = getDaysInMonth(now);
  const remainingDays = daysInMonth - now.getDate();
  const projectedMonthlyIncome =
    monthlyIncome > 0 ? (monthlyIncome / daysInMonth) * remainingDays : 0;

  const predictedBalance =
    currentBalance + futureCashFlow - taskCosts + projectedMonthlyIncome;
  const exposure = Math.abs(futureCashFlow) + taskCosts;

  return {
    predictedBalance,
    riskLevel: classifyRisk(predictedBalance, exposure, monthlyIncome),
    factors: {
      currentBalance,
      futureCashFlow,
      taskCosts,
      monthlyIncome,
      projectedMonthlyIncome,
      remainingDays,
    },
  };
}

export type ForecastCalculation = ReturnType<typeof calculateForecast>;
