import { toNumber } from './number';
import { signedBalance } from './signed-balance';
import { DashboardSummary } from './dashboard-summary.type';
import { SummarySources } from './summary-sources.type';

type RecentTransaction = SummarySources['recentTransactions'][number];

const mapRecentTransaction = (transaction: RecentTransaction) => ({
  ...transaction,
  amount: Number(transaction.amount),
});

export function mapFinances(
  sources: Pick<SummarySources, 'balanceRows' | 'monthlyExpenses' | 'monthlyIncome' | 'recentTransactions'>,
): DashboardSummary['finances'] {
  return {
    balance: signedBalance(sources.balanceRows),
    monthlyExpenses: toNumber(sources.monthlyExpenses._sum.amount),
    monthlyIncome: toNumber(sources.monthlyIncome._sum.amount),
    recentTransactions: sources.recentTransactions.map(mapRecentTransaction),
  };
}
