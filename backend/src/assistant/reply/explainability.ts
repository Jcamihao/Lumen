import { AssistantConfidence, AssistantContinuity, AssistantExplainability, AssistantReply, DashboardSummary } from '../assistant.types';
import { formatCurrency, summaryCurrency } from '../format/format-values';
import { readNonEmptyList } from '../parsing/readers';
import { matchQuestionTargets } from '../question/question-context';

export function buildExplainability(
  summary: DashboardSummary,
  question: string,
  reply: AssistantReply,
  continuity: AssistantContinuity,
): AssistantExplainability {
  const currency = summaryCurrency(summary);
  const evidence = [
    `Saldo atual observado: ${formatCurrency(summary.finances.balance, currency)}.`,
    `Saldo previsto no horizonte atual: ${formatCurrency(
      Number(summary.forecast.predictedBalance ?? 0),
      currency,
    )}.`,
    summary.tasks.items[0]
      ? `Tarefa concreta em foco: ${summary.tasks.items[0].title}.`
      : null,
    summary.finances.recentTransactions[0]
      ? `Movimentação recente relevante: ${summary.finances.recentTransactions[0].description}.`
      : null,
    summary.goals[0]
      ? `Meta ativa usada como contexto: ${summary.goals[0].title}.`
      : null,
    continuity.memorySummary,
  ];
  const reasoning =
    reply.explainability.reasoning.length > 0
      ? reply.explainability.reasoning
      : fallbackReasoning(summary, question, reply.focusArea || "Panorama");

  return {
    reasoning: reasoning.slice(0, 4),
    evidence: readNonEmptyList(evidence, 5),
    confidenceReason:
      reply.explainability.confidenceReason ||
      fallbackConfidenceReason(summary, reply.confidence, question),
  };
}

export function fallbackReasoning(
  summary: DashboardSummary,
  question: string,
  focusArea: string,
) {
  const reasoning = [];

  reasoning.push(
    `A resposta parte da sua pergunta atual e do foco ${focusArea.toLowerCase()} detectado no LUMEN.`,
  );
  reasoning.push(
    `O Selah cruzou tarefas do dia, fluxo financeiro e metas para evitar conselho genérico.`,
  );

  if (summary.forecast.riskLevel === "HIGH") {
    reasoning.push(
      "Como a previsão está em risco alto, o plano puxa contenção e priorização antes de expansão.",
    );
  }

  if (matchQuestionTargets(summary, question).length > 0) {
    reasoning.push(
      "Itens citados explicitamente na sua pergunta ganharam prioridade sobre o panorama amplo.",
    );
  }

  return reasoning.slice(0, 4);
}

export function fallbackConfidenceReason(
  summary: DashboardSummary,
  confidence: AssistantConfidence,
  question: string,
) {
  const anchors = matchQuestionTargets(summary, question).length;

  if (confidence === "high") {
    return `A confiança está alta porque havia dados concretos suficientes no app${anchors ? ` e ${anchors} alvo(s) citado(s) por você` : ""}.`;
  }

  if (confidence === "low") {
    return "A confiança ficou mais baixa porque faltam detalhes críticos para simular ou recomendar algo mais preciso.";
  }

  return "A confiança ficou média porque o cenário já tem sinais úteis, mas ainda sem todos os detalhes operacionais ou contratuais.";
}
