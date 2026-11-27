export function extractQuestionAmount(question: string) {
  const matches = String(question || "")
    .match(/(?:r\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\s*(?:mil|k)?/gi);

  const first = matches?.[0];
  if (!first) {
    return null;
  }

  const normalized = first.toLowerCase().replace(/\s+/g, "");
  const multiplier = normalized.includes("mil") || normalized.includes("k") ? 1000 : 1;
  const numeric = normalized
    .replace(/r\$/g, "")
    .replace(/mil|k/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const amount = Number(numeric);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return amount * multiplier;
}
