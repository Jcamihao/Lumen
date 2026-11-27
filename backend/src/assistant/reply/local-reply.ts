import { AssistantReply, DashboardSummary } from '../assistant.types';
import { detectIntent, resolveFocusArea } from '../question/intent';
import { formatCurrency, formatDate, goalProgress, summaryCurrency } from '../format/format-values';
import { ensureActions, ensureHighlights } from './reply-lists';

export function buildLocalReply(
  summary: DashboardSummary,
  question: string,
  disclaimer: string | null,
): AssistantReply {
  const intent = detectIntent(question);
  const currency = summaryCurrency(summary);
  const criticalInsights = summary.insights.filter(
    (insight) => insight.severity === "CRITICAL",
  );
  const nextTasks = summary.tasks.items.slice(0, 3);
  const goals = summary.goals.slice(0, 2);
  const focusArea = resolveFocusArea(intent);

  let answer = "";

  if (intent === "priorities") {
    const priorities = nextTasks
      .map(
        (task) =>
          `${task.title}${task.dueDate ? ` (${formatDate(task.dueDate)})` : ""}`,
      )
      .join(", ");

    answer =
      `Hoje eu puxaria a fila por ${priorities || "tarefas sem prazo imediato"}. ` +
      "Comece pelo que vence antes, tem impacto financeiro ou destrava o resto do dia.";
  } else if (intent === "finance_overview") {
    answer =
      `Seu saldo atual esta em ${formatCurrency(summary.finances.balance, currency)}. ` +
      `Neste mes voce movimentou ${formatCurrency(summary.finances.monthlyIncome, currency)} em entradas, ` +
      `${formatCurrency(summary.finances.monthlyExpenses, currency)} em saidas ` +
      `e a previsao aponta risco ${String(summary.forecast.riskLevel).toLowerCase()}.`;
  } else {
    answer =
      `Hoje voce tem ${summary.tasks.todayCount} tarefa(s) para o dia, ${summary.tasks.overdueCount} atrasada(s) e ` +
      `${criticalInsights.length > 0 ? `${criticalInsights.length} alerta(s) critico(s)` : "nenhum alerta critico"}. ` +
      `A previsao financeira atual esta em ${formatCurrency(Number(summary.forecast.predictedBalance ?? 0), currency)}.`;
  }

  return {
    answer,
    highlights: ensureHighlights([
      ...criticalInsights.map((insight) => insight.message),
      ...goals.map((goal) =>
        goal.targetAmount === null
          ? `Meta ${goal.title}: ${formatCurrency(goal.currentAmount, currency)} guardados (sem valor-alvo).`
          : `Meta ${goal.title}: ${goalProgress(goal)}% concluida.`,
      ),
    ]),
    suggestedActions: ensureActions([
      nextTasks[0] ? `Fechar a tarefa "${nextTasks[0].title}" hoje.` : null,
      summary.tasks.overdueCount > 0
        ? "Eliminar pelo menos uma pendencia atrasada."
        : null,
      summary.forecast.riskLevel === "HIGH"
        ? "Revisar despesas futuras e congelar gastos nao essenciais."
        : "Manter o ritmo atual e reforcar uma meta ativa.",
    ]),
    actions: [],
    proactiveSignals: [],
    simulations: [],
    continuity: {
      historyCount: 0,
      memorySummary: null,
      nextQuestion: null,
      followUpPrompt: null,
      originModule: null,
    },
    explainability: {
      reasoning: [],
      evidence: [],
      confidenceReason: "",
    },
    source: "lumen_fallback",
    provider: "LUMEN Local",
    focusArea,
    confidence: "medium",
    disclaimer,
    generatedAt: new Date().toISOString(),
  };
}
