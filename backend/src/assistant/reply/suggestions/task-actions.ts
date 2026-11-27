import { AssistantAction, DashboardSummary } from '../../assistant.types';
import { createAction } from '../../actions/create-action';
import { nextReminderDate } from '../action-dates';

const HIGH_OVERDUE_COUNT = 3;

/** Com tarefa atrasada, leva para a fila; sem atraso, lembra da tarefa mais concreta. */
export function taskActions(summary: DashboardSummary): AssistantAction[] {
  const topTask = summary.tasks.items[0];

  if (summary.tasks.overdueCount > 0) {
    return [
      createAction('open_module', {
        title: 'Abrir fila de tarefas',
        description: 'Leva você direto para as pendências que estão pressionando o dia.',
        targetModule: 'tasks',
        importance: summary.tasks.overdueCount >= HIGH_OVERDUE_COUNT ? 'high' : 'medium',
        route: '/tasks',
        payload: null,
      }),
    ];
  }
  if (!topTask) return [];

  return [
    createAction('create_reminder', {
      title: `Lembrar "${topTask.title}"`,
      description: 'Cria um lembrete para sustentar a prioridade mais concreta da sua fila.',
      targetModule: 'tasks',
      importance: 'medium',
      payload: { title: `Revisar ${topTask.title}`, remindAt: nextReminderDate(0, 18) },
    }),
  ];
}
