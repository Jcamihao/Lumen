import { AssistantAction, AssistantModule, DashboardSummary } from '../assistant.types';
import { nextDateInputValue, nextReminderDate } from './action-dates';
import { normalizeForMatch } from '../text/sanitize';
import { createAction } from '../actions/create-action';

export function buildActionSuggestions(
  summary: DashboardSummary,
  question: string,
  originModule: AssistantModule,
  focusArea: string,
) {
  const actions: AssistantAction[] = [];
  const tomorrowMorning = nextReminderDate(1, 9);
  const topTask = summary.tasks.items[0];
  const topGoal = summary.goals[0];
  const normalizedQuestion = normalizeForMatch(question);
  const financeHeavy =
    focusArea.toLowerCase().includes("financ") ||
    normalizedQuestion.includes("divid") ||
    normalizedQuestion.includes("saldo") ||
    normalizedQuestion.includes("gasto") ||
    summary.forecast.riskLevel === "HIGH";

  if (financeHeavy) {
    actions.push(
      createAction("create_task", {
        title: "Mapear dívidas, juros e parcelas",
        description:
          "Transforma a orientação do Selah em uma tarefa concreta dentro da sua rotina.",
        targetModule: "tasks",
        importance: "high",
        payload: {
          title: "Mapear dividas, juros e parcelas",
          description:
            "Levantar credores, valor em aberto, juros, atraso e ordem de negociacao.",
          priority: "HIGH",
          dueDate: nextDateInputValue(1),
          hasFinancialImpact: false,
        },
      }),
    );
    actions.push(
      createAction("create_reminder", {
        title: "Criar lembrete de revisão de caixa",
        description:
          "Agenda um checkpoint rápido para você confirmar se o plano saiu do papel.",
        targetModule: "finances",
        importance: "medium",
        payload: {
          title: "Revisar caixa e contas da semana",
          remindAt: tomorrowMorning,
        },
      }),
    );
  }

  if (summary.tasks.overdueCount > 0) {
    actions.push(
      createAction("open_module", {
        title: "Abrir fila de tarefas",
        description:
          "Leva você direto para as pendências que estão pressionando o dia.",
        targetModule: "tasks",
        importance: summary.tasks.overdueCount >= 3 ? "high" : "medium",
        route: "/tasks",
        payload: null,
      }),
    );
  } else if (topTask) {
    actions.push(
      createAction("create_reminder", {
        title: `Lembrar "${topTask.title}"`,
        description:
          "Cria um lembrete para sustentar a prioridade mais concreta da sua fila.",
        targetModule: "tasks",
        importance: "medium",
        payload: {
          title: `Revisar ${topTask.title}`,
          remindAt: nextReminderDate(0, 18),
        },
      }),
    );
  }

  if (!summary.goals.length && financeHeavy) {
    const targetAmount = Math.max(
      Math.round(summary.finances.monthlyExpenses || summary.user.monthlyIncome || 1000),
      1000,
    );
    actions.push(
      createAction("create_goal", {
        title: "Criar meta de reserva",
        description:
          "Abre uma meta base para proteger o caixa enquanto você reorganiza o mês.",
        targetModule: "goals",
        importance: "medium",
        payload: {
          title: "Reserva de seguranca",
          description:
            "Meta inicial criada a partir do contexto financeiro atual do LUMEN.",
          targetAmount,
          currentAmount: 0,
          targetDate: nextDateInputValue(90),
        },
      }),
    );
  } else if (topGoal) {
    actions.push(
      createAction("open_module", {
        title: `Ver meta ${topGoal.title}`,
        description:
          "Abre sua carteira de metas para decidir se vale reforçar prazo ou aporte.",
        targetModule: "goals",
        importance: "low",
        route: "/goals",
        payload: null,
      }),
    );
  }

  if (originModule === "imports") {
    actions.unshift(
      createAction("open_module", {
        title: "Voltar para importações",
        description:
          "Retorna para a compra ou nota que motivou esta conversa com o Selah.",
        targetModule: "imports",
        importance: "medium",
        route: "/imports",
        payload: null,
      }),
    );
  }

  return actions.slice(0, 4);
}
