import { AssistantAction } from '../../assistant.types';
import { createAction } from '../../actions/create-action';
import { nextDateInputValue, nextReminderDate } from '../action-dates';

/** Sugestoes para quando a pergunta ou a previsao pedem foco no dinheiro: mapear dividas e revisar o caixa. */
export function financeActions(): AssistantAction[] {
  return [
    createAction('create_task', {
      title: 'Mapear dívidas, juros e parcelas',
      description: 'Transforma a orientação do Selah em uma tarefa concreta dentro da sua rotina.',
      targetModule: 'tasks',
      importance: 'high',
      payload: {
        title: 'Mapear dividas, juros e parcelas',
        description: 'Levantar credores, valor em aberto, juros, atraso e ordem de negociacao.',
        priority: 'HIGH',
        dueDate: nextDateInputValue(1),
        hasFinancialImpact: false,
      },
    }),
    createAction('create_reminder', {
      title: 'Criar lembrete de revisão de caixa',
      description: 'Agenda um checkpoint rápido para você confirmar se o plano saiu do papel.',
      targetModule: 'finances',
      importance: 'medium',
      payload: { title: 'Revisar caixa e contas da semana', remindAt: nextReminderDate(1, 9) },
    }),
  ];
}
