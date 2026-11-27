export interface DateRange {
  start: Date;
  end: Date;
}

/** Janela do dia no fuso do servidor: da meia-noite ate 23:59:59.999. */
export function todayWindow(now: Date): DateRange {
  return {
    start: withLocalTime(now, 0, 0, 0, 0),
    end: withLocalTime(now, 23, 59, 59, 999),
  };
}

function withLocalTime(base: Date, hours: number, minutes: number, seconds: number, ms: number) {
  const date = new Date(base);
  date.setHours(hours, minutes, seconds, ms);
  return date;
}
