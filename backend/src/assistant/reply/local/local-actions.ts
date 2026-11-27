import { DashboardSummary } from '../../assistant.types';
import { ensureActions } from '../reply-lists';
import { nextTasksOf } from './local-context';

export function localSuggestedActions(summary: DashboardSummary) {
  const nextTask = nextTasksOf(summary)[0];
  return ensureActions([
    nextTask ? `Fechar a tarefa "${nextTask.title}" hoje.` : null,
    summary.tasks.overdueCount > 0
      ? "Eliminar pelo menos uma pendencia atrasada."
      : null,
    summary.forecast.riskLevel === "HIGH"
      ? "Revisar despesas futuras e congelar gastos nao essenciais."
      : "Manter o ritmo atual e reforcar uma meta ativa.",
  ]);
}
