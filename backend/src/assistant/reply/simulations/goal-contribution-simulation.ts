import { AssistantSimulation, DashboardSummary } from '../../assistant.types';
import { formatCurrency, roundToCents } from '../../format/format-values';
import { SimulationBase } from './simulation-base';

const CONTRIBUTION_SHARE = 0.15;

type Goal = DashboardSummary['goals'][number];

/** Aporte de 15% do saldo previsto na meta principal, limitado ao que falta; meta sem alvo nao entra. */
export function goalContributionSimulation(base: SimulationBase, topGoal: Goal | undefined): AssistantSimulation | null {
  // Meta sem alvo nao tem "quanto falta": sem simulacao de aporte tatico pra ela.
  if (!topGoal || topGoal.targetAmount === null) return null;
  const remaining = Math.max(topGoal.targetAmount - topGoal.currentAmount, 0);
  const contribution = Math.min(Math.max(roundToCents(base.forecastBalance * CONTRIBUTION_SHARE), 0), remaining);
  if (contribution > 0) return contributionSimulation(base, topGoal, contribution);
  return null;
}

function contributionSimulation(base: SimulationBase, topGoal: Goal, contribution: number): AssistantSimulation {
  const projectedBalance = base.forecastBalance - contribution;
  return {
    id: 'goal-contribution',
    title: `Aporte tático em ${topGoal.title}`,
    summary: `Separando ${formatCurrency(contribution, base.currency)} para ${topGoal.title}, a projeção de caixa cairia para ${formatCurrency(projectedBalance, base.currency)}, mas a meta ganharia tração imediata.`,
    monthlyDelta: -contribution,
    projectedBalance,
    confidence: base.forecastBalance > contribution ? 'medium' : 'low',
    assumptions: [
      'Considera uso de uma parte do saldo previsto, não do saldo histórico inteiro.',
      'Não substitui revisão das prioridades básicas do mês.',
    ],
  };
}
