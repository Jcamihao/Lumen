import { AssistantContinuity, AssistantModule, AssistantReply, DashboardSummary } from '../assistant.types';
import { AskAssistantHistoryItemDto } from "../dto/ask-assistant.dto";
import { normalizeForMatch, sanitizeExternalText } from '../text/sanitize';

export function buildContinuity(
  summary: DashboardSummary,
  question: string,
  reply: AssistantReply,
  history: AskAssistantHistoryItemDto[],
  originModule: AssistantModule,
): AssistantContinuity {
  const recentHistory = history.slice(0, 2);
  const memorySummary = recentHistory.length
    ? `Nas últimas ${recentHistory.length} conversa(s), você passou por ${recentHistory
        .map((item) => sanitizeExternalText(item.question).slice(0, 70))
        .join(" e ")}.`
    : null;
  const followUpPrompt =
    reply.continuity.followUpPrompt ||
    defaultFollowUpPrompt(summary, reply.focusArea || "Panorama");

  return {
    historyCount: recentHistory.length,
    memorySummary,
    nextQuestion: defaultNextQuestion(summary, question, reply.focusArea || "Panorama"),
    followUpPrompt,
    originModule,
  };
}

export function defaultFollowUpPrompt(summary: DashboardSummary, focusArea: string) {
  if (focusArea.toLowerCase().includes("financ")) {
    return "Me ajuda a transformar isso num plano de 7 dias.";
  }

  if (summary.tasks.overdueCount > 0) {
    return "Monta uma ordem prática para eu limpar essas pendências.";
  }

  if (summary.goals[0]) {
    return `Monta um próximo passo simples para a meta ${summary.goals[0].title}.`;
  }

  return "Traduz isso em um plano curto e executável.";
}

export function defaultNextQuestion(
  summary: DashboardSummary,
  question: string,
  focusArea: string,
) {
  const normalizedQuestion = normalizeForMatch(question);

  if (normalizedQuestion.includes("divid") || focusArea.toLowerCase().includes("financ")) {
    return "Qual corte ou negociação me dá mais fôlego nos próximos 30 dias?";
  }

  if (summary.tasks.items[0]) {
    return `Como encaixar ${summary.tasks.items[0].title} sem travar o resto do dia?`;
  }

  if (summary.goals[0]) {
    return `Qual o menor aporte útil para a meta ${summary.goals[0].title}?`;
  }

  return "Qual é o próximo passo com melhor impacto agora?";
}
