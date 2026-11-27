import { AssistantModule, AssistantProactiveSignal, AssistantProactiveSignalSeverity, DashboardSummary } from '../assistant.types';
import { formatCurrency, formatEnumLabel, summaryCurrency } from '../format/format-values';

/**
 * Traduz os insights do motor (summary.insights, ja carimbados com persona
 * e severidade) em sinais proativos do chat/pulso.
 *
 * Antes esse metodo reimplementava manualmente 3 das regras que o motor de
 * insights ja calcula (tarefas atrasadas, meta travada, janela calma), com
 * thresholds levemente diferentes dos do motor. Isso significava que todo
 * detector novo em insights.service (cobranca duplicada, assinatura,
 * impacto financeiro atrasado, meta bloqueada por tarefa) ficava invisivel
 * aqui, so aparecendo no dashboard e no texto corrido da resposta.
 *
 * O risco de caixa fica de fora do mapeamento porque vem de Forecast, uma
 * entidade separada de Insight — nao ha detector equivalente no motor.
 */
export function buildProactiveSignals(
  summary: DashboardSummary,
  question: string,
  originModule: AssistantModule,
) {
  const signals: AssistantProactiveSignal[] = [];
  const hasQuestion = Boolean(String(question || "").trim());

  if (summary.forecast.riskLevel === "HIGH") {
    signals.push({
      id: "cash-risk",
      title: "Caixa sob pressão",
      message: `A projeção atual fecha em ${formatCurrency(
        Number(summary.forecast.predictedBalance ?? 0),
        summaryCurrency(summary),
      )}, então vale revisar saídas variáveis antes que o mês aperte de vez.`,
      severity: "critical",
      targetModule: "finances",
      suggestedPrompt: "O que eu preciso proteger primeiro no meu caixa este mês?",
      suggestedActionLabel: "Olhar finanças",
    });
  }

  const relevantInsights = summary.insights.filter((insight) => {
    // O fallback "tudo calmo" e util no pulso vazio, mas polui a leitura
    // quando o usuario ja fez uma pergunta especifica.
    const isCalmFallback = insight.fingerprint?.split(":")[1] === "calm";

    return !(hasQuestion && isCalmFallback);
  });

  for (const insight of relevantInsights) {
    const hints =
      INSIGHT_SIGNAL_HINTS[insight.type] ?? INSIGHT_SIGNAL_HINTS.ROUTINE;
    const persona = insight.metadata?.persona?.name;

    signals.push({
      id: insight.fingerprint ?? `insight-${insight.type.toLowerCase()}`,
      title: persona ?? formatEnumLabel(insight.type),
      message: insight.message,
      severity: mapInsightSeverity(insight.severity),
      targetModule: hints.targetModule ?? originModule,
      suggestedPrompt: hints.suggestedPrompt,
      suggestedActionLabel: hints.suggestedActionLabel,
    });
  }

  return signals.slice(0, 3);
}

export function mapInsightSeverity(severity: string): AssistantProactiveSignalSeverity {
  if (severity === "CRITICAL") {
    return "critical";
  }

  if (severity === "WARNING") {
    return "warning";
  }

  return "info";
}

/**
 * Modulo, pergunta de acompanhamento e rotulo de acao sugeridos por tipo de
 * insight. O motor de insights nao carrega essas tres coisas (fala so em
 * modulo de dominio, nao em UX de chat), entao ficam aqui, num unico lugar.
 */
export const INSIGHT_SIGNAL_HINTS: Record<
  string,
  { targetModule: AssistantModule | null; suggestedPrompt: string; suggestedActionLabel: string }
> = {
  PRODUCTIVITY: {
    targetModule: "tasks",
    suggestedPrompt: "Quais pendências atrasadas eu devo limpar primeiro?",
    suggestedActionLabel: "Abrir tarefas",
  },
  FINANCE: {
    targetModule: "finances",
    suggestedPrompt: "O que eu preciso proteger primeiro no meu caixa este mês?",
    suggestedActionLabel: "Olhar finanças",
  },
  GOAL: {
    targetModule: "goals",
    suggestedPrompt: "Como destravar minhas metas travadas?",
    suggestedActionLabel: "Rever metas",
  },
  // ROUTINE nao tem modulo proprio: fica no modulo de onde a pergunta partiu
  // (ou "dashboard" no pulso, sem pergunta), em vez de sempre mandar pro
  // dashboard mesmo quando o usuario esta conversando a partir de outra tela.
  ROUTINE: {
    targetModule: null,
    suggestedPrompt: "Onde vale colocar energia para ganhar mais tração esta semana?",
    suggestedActionLabel: "Conversar com Selah",
  },
};
