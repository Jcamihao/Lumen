import { AssistantSimulation, DashboardSummary, SpendingAnalysis } from '../assistant.types';
import { extractQuestionAmount } from '../question/question-amount';
import { debtSimulation } from './simulations/debt-simulation';
import { expenseTrimSimulation } from './simulations/expense-trim-simulation';
import { goalContributionSimulation } from './simulations/goal-contribution-simulation';
import { simulationBase } from './simulations/simulation-base';

const MAX_SIMULATIONS = 3;

/** Junta as simulacoes personalizadas (gasto, divida citada na pergunta e meta principal), no maximo 3. */
export function buildSimulations(
  summary: DashboardSummary,
  question: string,
  spendingAnalysis: SpendingAnalysis,
): AssistantSimulation[] {
  const base = simulationBase(summary);
  const candidates = [
    expenseTrimSimulation(base, spendingAnalysis),
    debtSimulation(base, extractQuestionAmount(question), spendingAnalysis.avgMonthlySurplus),
    goalContributionSimulation(base, summary.goals[0]),
  ];
  return candidates.filter(isSimulation).slice(0, MAX_SIMULATIONS);
}

function isSimulation(sim: AssistantSimulation | null): sim is AssistantSimulation {
  return sim !== null;
}
