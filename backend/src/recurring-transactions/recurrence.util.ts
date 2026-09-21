import { RecurrenceFrequency } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Datas de conta fixa sao "so data", gravadas a meia-noite UTC (o mesmo padrao
 * das transacoes). Tudo aqui trabalha em UTC de proposito: getDate()/setMonth()
 * usariam o fuso do servidor e deslocariam o vencimento em um dia.
 */
export function utcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function daysInMonthUtc(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** "Hoje" no fuso do usuario, como data-sem-hora em UTC. Fuso invalido cai em UTC. */
export function localToday(now: Date, timeZone: string) {
  try {
    const iso = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const [year, month, day] = iso.split('-').map(Number);

    return utcDate(year, month - 1, day);
  } catch {
    return utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }
}

export function addDaysUtc(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Proximo vencimento depois de `current`.
 * - WEEKLY: +7 dias.
 * - MONTHLY: mesmo dia no mes seguinte; `anchorDay` e mantido de fora, entao
 *   uma conta do dia 31 cai no dia 28/29/30 nos meses curtos e volta ao 31 depois.
 * - YEARLY: mesmo mes e dia no ano seguinte (29/02 vira 28/02 em ano comum).
 */
export function nextOccurrence(
  current: Date,
  frequency: RecurrenceFrequency,
  anchorDay: number,
) {
  if (frequency === RecurrenceFrequency.WEEKLY) {
    return addDaysUtc(current, 7);
  }

  const monthsToAdd = frequency === RecurrenceFrequency.YEARLY ? 12 : 1;
  const totalMonths = current.getUTCFullYear() * 12 + current.getUTCMonth() + monthsToAdd;
  const year = Math.floor(totalMonths / 12);
  const monthIndex = totalMonths % 12;

  return utcDate(year, monthIndex, Math.min(anchorDay, daysInMonthUtc(year, monthIndex)));
}

/** Primeiro vencimento em `from` ou depois, andando a partir de `due` (usado ao retomar uma conta pausada). */
export function firstOccurrenceOnOrAfter(
  due: Date,
  from: Date,
  frequency: RecurrenceFrequency,
  anchorDay: number,
) {
  let candidate = due;
  // Trava de seguranca: ~10 anos de vencimentos semanais.
  for (let i = 0; i < 600 && candidate < from; i += 1) {
    candidate = nextOccurrence(candidate, frequency, anchorDay);
  }

  return candidate;
}
