import { DashboardSummary } from '../assistant.types';
import { firstMeaningfulFragment, normalizeForMatch } from '../text/sanitize';

export function buildQuestionContextSummary(
  summary: DashboardSummary,
  question: string,
) {
  const normalizedQuestion = normalizeForMatch(question);
  const matchedTargets = matchQuestionTargets(summary, question);
  const signals = [
    normalizedQuestion.includes("por que") ? "causa" : null,
    normalizedQuestion.includes("como") ? "orientacao pratica" : null,
    normalizedQuestion.includes("devo") || normalizedQuestion.includes("prioriz")
      ? "decisao de prioridade"
      : null,
    normalizedQuestion.includes("risco") ||
    normalizedQuestion.includes("saldo") ||
    normalizedQuestion.includes("gasto") ||
    normalizedQuestion.includes("dinheiro") ||
    normalizedQuestion.includes("divid") ||
    normalizedQuestion.includes("dívida") ||
    normalizedQuestion.includes("quitar") ||
    normalizedQuestion.includes("renegoci") ||
    normalizedQuestion.includes("juros") ||
    normalizedQuestion.includes("parcela")
      ? "leitura financeira"
      : null,
    normalizedQuestion.includes("rotina") ||
    normalizedQuestion.includes("vida pessoal") ||
    normalizedQuestion.includes("foco") ||
    normalizedQuestion.includes("cansa") ||
    normalizedQuestion.includes("procrast")
      ? "organizacao de vida pessoal"
      : null,
    normalizedQuestion.includes("meta") ? "progresso de meta" : null,
    normalizedQuestion.includes("tarefa") ? "execucao de tarefa" : null,
  ].filter(Boolean);

  if (matchedTargets.length) {
    return `O usuário citou explicitamente ${matchedTargets.join(", ")}. A resposta deve começar por esse(s) item(ns) e só depois conectar panorama mais amplo se isso ajudar a responder a pergunta. Sinais da pergunta: ${signals.join(", ") || "leitura contextual"}. Formato esperado: resposta mais detalhada, em 2 ou 3 blocos curtos, cobrindo resposta direta, contexto e próximos passos.`;
  }

  return `A resposta deve priorizar o que a pergunta pede de forma direta, sem cair em panorama padrão quando não for necessário. Sinais da pergunta: ${signals.join(", ") || "leitura contextual"}. Formato esperado: resposta mais detalhada, em 2 ou 3 blocos curtos, cobrindo resposta direta, contexto e próximos passos.`;
}

export function matchQuestionTargets(summary: DashboardSummary, question: string) {
  const normalizedQuestion = normalizeForMatch(question);
  const candidates = [
    ...summary.tasks.items.map((task) => task.title),
    ...summary.finances.recentTransactions.map(
      (transaction) => transaction.description,
    ),
    ...summary.goals.map((goal) => goal.title),
    ...summary.insights.map((insight) => firstMeaningfulFragment(insight.message)),
  ]
    .map((value) => String(value || "").trim())
    .filter((value) => value.length >= 4);

  const matches = candidates.filter((candidate) => {
    const normalizedCandidate = normalizeForMatch(candidate);

    if (normalizedQuestion.includes(normalizedCandidate)) {
      return true;
    }

    const significantTokens = normalizedCandidate
      .split(" ")
      .filter((token) => token.length >= 4);
    const tokenMatches = significantTokens.filter((token) =>
      normalizedQuestion.includes(token),
    ).length;

    return tokenMatches >= Math.min(2, significantTokens.length);
  });

  return Array.from(new Set(matches)).slice(0, 5);
}
