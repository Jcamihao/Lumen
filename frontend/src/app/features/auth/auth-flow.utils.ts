export function readApiError(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } })?.error?.message;

  if (Array.isArray(message) && message.length > 0) {
    return String(message[0]);
  }

  return typeof message === 'string' && message.trim() ? message : fallback;
}
