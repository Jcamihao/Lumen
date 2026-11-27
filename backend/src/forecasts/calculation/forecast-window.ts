import { addDays, startOfDay } from "date-fns";

export const FORECAST_HORIZON_DAYS = 30;

export type ForecastWindow = { now: Date; horizon: Date; todayStart: Date };

export function forecastWindow(now: Date): ForecastWindow {
  return {
    now,
    horizon: addDays(now, FORECAST_HORIZON_DAYS),
    todayStart: startOfDay(now),
  };
}
