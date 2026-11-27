export const MS_PER_DAY = 24 * 60 * 60 * 1000;

const INVALID_LOCAL_TIME = -1;

function formatInTimezone<T>(
  timezone: string,
  options: Intl.DateTimeFormatOptions,
  parse: (text: string) => T,
  fallback: T,
): T {
  try {
    const text = new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options }).format(
      new Date(),
    );
    return parse(text);
  } catch {
    // Fuso horario invalido salvo no usuario: nunca bate a hora alvo, em
    // vez de derrubar o scan inteiro pra todo mundo.
    return fallback;
  }
}

export function localHourFor(timezone: string): number {
  return formatInTimezone(
    timezone,
    { hour: "numeric", hour12: false },
    (text) => parseInt(text, 10) % 24,
    INVALID_LOCAL_TIME,
  );
}

export function localDayOfMonthFor(timezone: string): number {
  return formatInTimezone(
    timezone,
    { day: "numeric" },
    (text) => parseInt(text, 10),
    INVALID_LOCAL_TIME,
  );
}

export function isMondayLocal(timezone: string): boolean {
  return formatInTimezone(timezone, { weekday: "short" }, (text) => text === "Mon", false);
}

export function daysSince(date: Date | null): number {
  if (!date) return Infinity;
  return (Date.now() - date.getTime()) / MS_PER_DAY;
}
