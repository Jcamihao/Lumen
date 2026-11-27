export function errorPercentOf(predicted: number, actual: number): number {
  if (predicted !== 0) {
    return ((actual - predicted) / Math.abs(predicted)) * 100;
  }

  return actual === 0 ? 0 : 100;
}
