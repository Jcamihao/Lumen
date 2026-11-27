import { InsightSeverity, InsightType, Task } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { formatAmount } from '../format-amount';
import { GeneratedInsight } from '../insight.types';

const CRITICAL_SHARE_OF_INCOME = 0.25;

function costMessage(costly: Task[], amount: string): string {
  return costly.length === 1
    ? `A tarefa ${costly[0].title} esta atrasada e carrega ${amount} de impacto estimado. Adiar isso adia o dinheiro junto.`
    : `Voce tem ${amount} em impacto estimado parado em ${costly.length} tarefas atrasadas. Destravar essas primeiro tende a render mais que o resto da fila.`;
}

/**
 * Dinheiro parado em tarefa adiada.
 *
 * Cruza atraso com impacto financeiro: o usuario ja marcou a tarefa como
 * tendo custo e estimou um valor, entao da para dizer quanto esta preso na
 * fila em vez de so contar quantas tarefas atrasaram.
 */
export function detectOverdueFinancialCost(context: InsightContext): GeneratedInsight | null {
  const costly = context.overdueTasks.filter((task) => task.hasFinancialImpact && task.estimatedAmount !== null);
  if (costly.length === 0) return null;

  const total = costly.reduce((sum, task) => sum + Number(task.estimatedAmount), 0);
  if (total <= 0) return null;

  const { monthlyIncome } = context;
  // Pesa o valor contra a renda quando ela e conhecida: o mesmo valor absoluto
  // significa coisas diferentes para rendas diferentes.
  const isCritical = monthlyIncome > 0 && total >= monthlyIncome * CRITICAL_SHARE_OF_INCOME;
  const amount = formatAmount(total, context.user.preferredCurrency);

  return {
    type: InsightType.PRODUCTIVITY,
    key: 'overdue_financial_cost',
    severity: isCritical ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
    message: costMessage(costly, amount),
    metadata: {
      totalEstimatedAmount: total,
      tasks: costly.map((task) => ({
        id: task.id,
        title: task.title,
        estimatedAmount: Number(task.estimatedAmount),
      })),
    },
  };
}
