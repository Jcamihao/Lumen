import { ForecastRiskLevel } from "@prisma/client";

const MEDIUM_BALANCE_RATIO = 0.25;
const MEDIUM_EXPOSURE_RATIO = 0.6;

export function classifyRisk(
  predictedBalance: number,
  exposure: number,
  monthlyIncome: number,
): ForecastRiskLevel {
  const hasIncome = monthlyIncome > 0;

  if (predictedBalance < 0 || (hasIncome && exposure >= monthlyIncome)) {
    return ForecastRiskLevel.HIGH;
  }

  if (
    predictedBalance < monthlyIncome * MEDIUM_BALANCE_RATIO ||
    (hasIncome && exposure >= monthlyIncome * MEDIUM_EXPOSURE_RATIO)
  ) {
    return ForecastRiskLevel.MEDIUM;
  }

  return ForecastRiskLevel.LOW;
}
