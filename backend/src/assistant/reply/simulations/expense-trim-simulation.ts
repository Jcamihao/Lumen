import { AssistantSimulation, SpendingAnalysis } from '../../assistant.types';
import { formatCurrency, roundToCents } from '../../format/format-values';
import { SimulationBase } from './simulation-base';

const TRIM_SHARE = 0.1;

type TopCategory = NonNullable<SpendingAnalysis['topVariableCategory']>;

/** Corta 10% da categoria de gasto variavel com mais folga; sem ela, 10% das despesas do mes. */
export function expenseTrimSimulation(base: SimulationBase, spending: SpendingAnalysis): AssistantSimulation | null {
  if (spending.topVariableCategory) return categoryTrim(base, spending.topVariableCategory);
  if (base.monthlyExpenses > 0) return flatTrim(base);
  return null;
}

function categoryTrim(base: SimulationBase, { name, total }: TopCategory): AssistantSimulation {
  const delta = roundToCents(total * TRIM_SHARE);
  const projectedBalance = base.forecastBalance + delta;
  return {
    id: 'expense-trim-category',
    title: `Corte em ${name}`,
    summary: `"${name}" foi sua categoria de maior gasto variável nos últimos 3 meses (${formatCurrency(total, base.currency)} no total). Enxugando 10% dela, a projeção vai para ${formatCurrency(projectedBalance, base.currency)}.`,
    monthlyDelta: delta,
    projectedBalance,
    confidence: 'medium',
    assumptions: [
      'Baseado no histórico real de transações da categoria nos últimos 3 meses, não numa média genérica.',
      'Categoria considerada variável por oscilar de mês a mês — gastos fixos como aluguel ficam de fora.',
    ],
  };
}

function flatTrim(base: SimulationBase): AssistantSimulation {
  const delta = roundToCents(base.monthlyExpenses * TRIM_SHARE);
  const projectedBalance = base.forecastBalance + delta;
  return {
    id: 'expense-trim-10',
    title: 'Ajuste leve de gastos',
    summary: `Se você enxugar perto de 10% das saídas variáveis do mês, a projeção vai para ${formatCurrency(projectedBalance, base.currency)}.`,
    monthlyDelta: delta,
    projectedBalance,
    confidence: 'medium',
    assumptions: [
      'Estimativa baseada nas despesas registradas neste mês.',
      'Sem categorias com histórico suficiente nos últimos 3 meses pra apontar uma específica.',
    ],
  };
}
