import { AssistantAction, DashboardSummary } from '../../assistant.types';
import { createAction } from '../../actions/create-action';
import { nextDateInputValue } from '../action-dates';

const MIN_RESERVE_TARGET = 1000;
const RESERVE_TARGET_DAYS = 90;

function createReserveGoalAction(summary: DashboardSummary): AssistantAction {
  const targetAmount = Math.max(
    Math.round(summary.finances.monthlyExpenses || summary.user.monthlyIncome || MIN_RESERVE_TARGET),
    MIN_RESERVE_TARGET,
  );
  return createAction('create_goal', {
    title: 'Criar meta de reserva',
    description: 'Abre uma meta base para proteger o caixa enquanto você reorganiza o mês.',
    targetModule: 'goals',
    importance: 'medium',
    payload: {
      title: 'Reserva de seguranca',
      description: 'Meta inicial criada a partir do contexto financeiro atual do LUMEN.',
      targetAmount,
      currentAmount: 0,
      targetDate: nextDateInputValue(RESERVE_TARGET_DAYS),
    },
  });
}

/** Sem metas e com foco financeiro, sugere criar a reserva; com metas, sugere abrir a primeira. */
export function goalActions(summary: DashboardSummary, financeHeavy: boolean): AssistantAction[] {
  const topGoal = summary.goals[0];

  if (!summary.goals.length && financeHeavy) return [createReserveGoalAction(summary)];
  if (!topGoal) return [];

  return [
    createAction('open_module', {
      title: `Ver meta ${topGoal.title}`,
      description: 'Abre sua carteira de metas para decidir se vale reforçar prazo ou aporte.',
      targetModule: 'goals',
      importance: 'low',
      route: '/goals',
      payload: null,
    }),
  ];
}
