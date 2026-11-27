export function detectIntent(question: string) {
  const normalizedQuestion = question.toLowerCase();

  if (normalizedQuestion.includes("prioriz")) {
    return "priorities" as const;
  }

  if (
    normalizedQuestion.includes("finance") ||
    normalizedQuestion.includes("saldo") ||
    normalizedQuestion.includes("dinheiro") ||
    normalizedQuestion.includes("divid") ||
    normalizedQuestion.includes("dívida") ||
    normalizedQuestion.includes("quitar") ||
    normalizedQuestion.includes("renegoci") ||
    normalizedQuestion.includes("juros") ||
    normalizedQuestion.includes("parcela") ||
    normalizedQuestion.includes("cartão") ||
    normalizedQuestion.includes("cartao") ||
    normalizedQuestion.includes("emprést") ||
    normalizedQuestion.includes("emprest") ||
    normalizedQuestion.includes("despesa") ||
    normalizedQuestion.includes("gasto") ||
    normalizedQuestion.includes("orçamento") ||
    normalizedQuestion.includes("orcamento")
  ) {
    return "finance_overview" as const;
  }

  if (
    normalizedQuestion.includes("como estou hoje") ||
    normalizedQuestion.includes("meu dia") ||
    normalizedQuestion.includes("hoje")
  ) {
    return "today_overview" as const;
  }

  return "general" as const;
}

export function resolveFocusArea(
  intent: "today_overview" | "priorities" | "finance_overview" | "general",
) {
  if (intent === "priorities") {
    return "Prioridades";
  }

  if (intent === "finance_overview") {
    return "Financeiro";
  }

  return "Panorama";
}
