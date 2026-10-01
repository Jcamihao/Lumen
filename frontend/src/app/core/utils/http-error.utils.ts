/**
 * Le a mensagem de erro de uma resposta HTTP 400 (validacao do backend), que
 * chega como `message: string` ou `message: string[]` (class-validator).
 * Qualquer outro status ou formato cai no `fallback`.
 */
export function readErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const httpError = error as { status?: unknown; error?: { message?: unknown } };
  if (httpError.status !== 400) {
    return fallback;
  }

  const message = httpError.error?.message;

  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message) && message.length) {
    return String(message[0]);
  }

  return fallback;
}
