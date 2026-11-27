import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { GeneratedInsight } from '../insight.types';

const WARNING_RATIO = 0.85;

export function detectExpenseRatio(context: InsightContext): GeneratedInsight | null {
  const { monthlyExpenses, monthlyIncome } = context;
  if (monthlyIncome <= 0 || monthlyExpenses < monthlyIncome * WARNING_RATIO) return null;

  const critical = monthlyExpenses >= monthlyIncome;
  return {
    type: InsightType.FINANCE,
    key: 'expense_ratio',
    severity: critical ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
    message: critical
      ? 'Suas despesas do mes ja encostaram na sua renda. Vale frear gastos variaveis e revisar contas futuras.'
      : 'Suas despesas do mes ja passaram de 85% da sua renda. Um ajuste leve agora reduz risco no fechamento.',
    metadata: { monthlyExpenses, monthlyIncome },
  };
}
