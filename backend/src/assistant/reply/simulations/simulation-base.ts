import { DashboardSummary } from '../../assistant.types';
import { summaryCurrency } from '../../format/format-values';

export type SimulationBase = {
  currency: string;
  forecastBalance: number;
  monthlyExpenses: number;
};

export function simulationBase(summary: DashboardSummary): SimulationBase {
  return {
    currency: summaryCurrency(summary),
    forecastBalance: Number(summary.forecast.predictedBalance ?? 0),
    monthlyExpenses: Number(summary.finances.monthlyExpenses ?? 0),
  };
}
