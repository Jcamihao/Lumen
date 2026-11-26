const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

function localHour(now: Date, timeZone: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  } catch {
    return localHour(now, DEFAULT_TIME_ZONE);
  }
}

/** Saudacao pela hora local do usuario: 5h-11h manha, 12h-17h tarde, resto noite. */
export function greetingFor(now: Date, timeZone: string): string {
  const hour = localHour(now, timeZone);
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
