/**
 * Datas "so dia" (lancamento, prazo de tarefa e de meta, data de compra) sao
 * gravadas a meia-noite UTC e chegam da API como 2026-09-21T00:00:00.000Z.
 * Lidas no fuso local (Brasil, UTC-3) viram 20/09 as 21h: o usuario via a data
 * um dia ANTES. Aqui o dia e lido em UTC quando o valor e "so dia" (ou
 * meia-noite UTC); instantes de verdade (createdAt, remindAt) seguem no fuso local.
 */
export function dayOnlyParts(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?Z)?$/);

  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

export function formatDayLabel(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' },
  locale = 'pt-BR',
) {
  if (!value) {
    return '';
  }

  const parts = dayOnlyParts(value);

  if (parts) {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
      new Date(Date.UTC(parts.year, parts.month - 1, parts.day)),
    );
  }

  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}

export function formatLocalDateLabel(value: string | null | undefined, locale = 'pt-BR') {
  return formatDayLabel(value, undefined, locale);
}

export function todayLocalInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}
