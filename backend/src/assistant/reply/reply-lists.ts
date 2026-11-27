import { ASSISTANT_REPLY_LIST_LIMIT } from '../assistant.constants';

export function ensureHighlights(items: Array<string | null | undefined>) {
  const normalized = items
    .filter((item): item is string => Boolean(item))
    .slice(0, ASSISTANT_REPLY_LIST_LIMIT);

  if (normalized.length) {
    return normalized;
  }

  return ["Nenhum alerta critico ativo neste momento."];
}

export function ensureActions(items: Array<string | null | undefined>) {
  const normalized = items
    .filter((item): item is string => Boolean(item))
    .slice(0, ASSISTANT_REPLY_LIST_LIMIT);

  if (normalized.length >= 2) {
    return normalized;
  }

  return [
    ...normalized,
    "Revisar o panorama do dia antes de abrir novas demandas.",
  ].slice(0, ASSISTANT_REPLY_LIST_LIMIT);
}
