import { AssistantAction, AssistantModule, DashboardSummary } from '../assistant.types';
import { createAction } from '../actions/create-action';
import { normalizeForMatch } from '../text/sanitize';
import { financeActions } from './suggestions/finance-actions';
import { goalActions } from './suggestions/goal-actions';
import { taskActions } from './suggestions/task-actions';

const MAX_SUGGESTIONS = 4;
const FINANCE_WORDS = ['divid', 'saldo', 'gasto'];

function isFinanceHeavy(summary: DashboardSummary, question: string, focusArea: string): boolean {
  const normalizedQuestion = normalizeForMatch(question);
  return (
    focusArea.toLowerCase().includes('financ') ||
    FINANCE_WORDS.some((word) => normalizedQuestion.includes(word)) ||
    summary.forecast.riskLevel === 'HIGH'
  );
}

function backToImportsAction(): AssistantAction {
  return createAction('open_module', {
    title: 'Voltar para importações',
    description: 'Retorna para a compra ou nota que motivou esta conversa com o Selah.',
    targetModule: 'imports',
    importance: 'medium',
    route: '/imports',
    payload: null,
  });
}

/** Acoes que o assistente propoe (criar tarefa, lembrete ou meta; abrir um modulo), no maximo 4. */
export function buildActionSuggestions(
  summary: DashboardSummary,
  question: string,
  originModule: AssistantModule,
  focusArea: string,
): AssistantAction[] {
  const financeHeavy = isFinanceHeavy(summary, question, focusArea);
  const actions = [
    ...(financeHeavy ? financeActions() : []),
    ...taskActions(summary),
    ...goalActions(summary, financeHeavy),
  ];
  if (originModule === 'imports') actions.unshift(backToImportsAction());

  return actions.slice(0, MAX_SUGGESTIONS);
}
