import { CreateTaskDto } from "../../tasks/dto/create-task.dto";
import { AssistantConfidence } from '../assistant.types';

export function readStringList(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

export function readNonEmptyList(
  items: Array<string | null | undefined>,
  maxItems: number,
) {
  return items.filter((item): item is string => Boolean(item)).slice(0, maxItems);
}

export function optionalString(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

export function optionalNumber(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

export function optionalTaskPriority(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase();

  if (
    normalized === "LOW" ||
    normalized === "MEDIUM" ||
    normalized === "HIGH" ||
    normalized === "CRITICAL"
  ) {
    return normalized as CreateTaskDto["priority"];
  }

  return undefined;
}

export function normalizeConfidence(value: unknown): AssistantConfidence {
  const normalized = String(value || "")
    .trim()
    .toLowerCase() as AssistantConfidence;

  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high"
  ) {
    return normalized;
  }

  return "medium";
}
