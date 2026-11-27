import { DashboardSummary } from '../assistant.types';

export function summaryCurrency(summary: DashboardSummary) {
  return summary.user.preferredCurrency || "BRL";
}

export function goalProgress(goal: { currentAmount: number; targetAmount: number | null }) {
  const target = Number(goal.targetAmount || 0);
  const current = Number(goal.currentAmount || 0);

  if (target <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
}

export function roundToCents(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return "horario nao informado";
  }

  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatEnumLabel(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
