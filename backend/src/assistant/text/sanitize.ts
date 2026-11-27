export function sanitizeExternalText(text: string) {
  return String(text || "")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[email removido]",
    )
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf removido]")
    .replace(
      /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}\b/g,
      "[telefone removido]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function normalizeForMatch(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9%$ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFirstName(name: string) {
  return (
    String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)[0] || "Voce"
  );
}

export function firstMeaningfulFragment(message: string) {
  return String(message || "")
    .split(/[.!?]/)[0]
    .trim();
}
