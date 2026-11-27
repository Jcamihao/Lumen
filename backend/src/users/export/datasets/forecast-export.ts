import { ExportableUser } from "../export-user.query";

export function mapForecasts(forecasts: ExportableUser["forecasts"]) {
  return forecasts.map((forecast) => ({
    ...forecast,
    predictedBalance: Number(forecast.predictedBalance),
  }));
}

export function mapForecastSnapshots(snapshots: ExportableUser["forecastSnapshots"]) {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    predictedBalance: Number(snapshot.predictedBalance),
    actualBalance:
      snapshot.actualBalance !== null && snapshot.actualBalance !== undefined
        ? Number(snapshot.actualBalance)
        : null,
    errorPercent:
      snapshot.errorPercent !== null && snapshot.errorPercent !== undefined
        ? Number(snapshot.errorPercent)
        : null,
  }));
}
