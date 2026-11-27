import { AssistantAction, AssistantActionKind } from '../assistant.types';
import { normalizeForMatch } from '../text/sanitize';
import { randomUUID } from "crypto";

export function createAction(
  kind: AssistantActionKind,
  input: Omit<AssistantAction, "id" | "kind" | "route" | "payload"> & {
    route?: string | null;
    payload?: Record<string, unknown> | null;
  },
): AssistantAction {
  return {
    id: `${kind}-${normalizeForMatch(input.title).replace(/\s+/g, "-").slice(0, 40) || randomUUID()}`,
    kind,
    route: input.route ?? null,
    payload: input.payload ?? null,
    ...input,
  };
}
