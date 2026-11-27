import { toNumber } from './number';
import { DashboardSummary } from './dashboard-summary.type';
import { SummarySources } from './summary-sources.type';

export function mapUser(user: SummarySources['user']): DashboardSummary['user'] {
  return {
    id: user.id,
    name: user.name,
    preferredCurrency: user.preferredCurrency,
    monthlyIncome: toNumber(user.monthlyIncome),
    birthDate: user.birthDate,
    occupation: user.occupation,
    primaryGoal: user.primaryGoal,
  };
}
