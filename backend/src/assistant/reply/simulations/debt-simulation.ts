import { AssistantSimulation } from '../../assistant.types';
import { formatCurrency, roundToCents } from '../../format/format-values';
import { SimulationBase } from './simulation-base';

const MIN_INSTALLMENTS = 1;
const MAX_INSTALLMENTS = 60;
const LINEAR_INSTALLMENTS = 8;
const SIMPLIFIED_CALCULATION = 'Cálculo simplificado, sem juros, multas ou descontos de negociação.';

/** Parcela a divida citada na pergunta: pela sobra media real, ou em 8 meses quando nao ha sobra. */
export function debtSimulation(
  base: SimulationBase,
  debtAmount: number | null,
  avgMonthlySurplus: number | null,
): AssistantSimulation | null {
  if (!debtAmount) return null;
  if (avgMonthlySurplus && avgMonthlySurplus > 0) return personalizedDebt(base, debtAmount, avgMonthlySurplus);
  return linearDebt(base, debtAmount);
}

function monthsText(months: number): string {
  return `${months} ${months === 1 ? 'mês' : 'meses'}`;
}

function personalizedDebt(base: SimulationBase, debtAmount: number, surplus: number): AssistantSimulation {
  const months = Math.min(Math.max(Math.ceil(debtAmount / surplus), MIN_INSTALLMENTS), MAX_INSTALLMENTS);
  const monthlyParcel = roundToCents(debtAmount / months);
  return {
    id: 'debt-personalized',
    title: `Parcelamento em ${monthsText(months)}`,
    summary: `Para uma dívida aproximada de ${formatCurrency(debtAmount, base.currency)}, usando sua sobra média real dos últimos 3 meses (${formatCurrency(surplus, base.currency)}/mês), uma quitação em ${monthsText(months)} sugere parcela perto de ${formatCurrency(monthlyParcel, base.currency)}.`,
    monthlyDelta: -monthlyParcel,
    projectedBalance: base.forecastBalance - monthlyParcel,
    confidence: 'medium',
    assumptions: [
      'Baseado na sobra média real (entradas menos saídas) dos últimos 3 meses, não num prazo fixo de 8 meses.',
      SIMPLIFIED_CALCULATION,
    ],
  };
}

function linearDebt(base: SimulationBase, debtAmount: number): AssistantSimulation {
  const monthlyParcel = roundToCents(debtAmount / LINEAR_INSTALLMENTS);
  return {
    id: 'debt-8x',
    title: `Parcelamento linear em ${LINEAR_INSTALLMENTS} meses`,
    summary: `Para uma dívida aproximada de ${formatCurrency(debtAmount, base.currency)}, uma divisão linear em ${LINEAR_INSTALLMENTS} meses sugere parcela perto de ${formatCurrency(monthlyParcel, base.currency)}.`,
    monthlyDelta: -monthlyParcel,
    projectedBalance: base.forecastBalance - monthlyParcel,
    confidence: 'low',
    assumptions: [
      'Sem sobra mensal positiva nos últimos 3 meses pra personalizar o prazo — usando 8 meses como referência neutra.',
      SIMPLIFIED_CALCULATION,
    ],
  };
}
