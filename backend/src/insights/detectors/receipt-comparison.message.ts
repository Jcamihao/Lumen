import { formatAmount } from '../format-amount';
import { ReceiptComparison } from './receipt-compare';

function trendText(comparison: ReceiptComparison): string {
  if (comparison.deltaPercent === null) return '';
  const trendWord = comparison.deltaAmount > 0 ? 'subiu' : comparison.deltaAmount < 0 ? 'caiu' : 'ficou igual';
  return ` (${trendWord} ${Math.round(Math.abs(comparison.deltaPercent) * 100)}%)`;
}

/** Complemento da mensagem: onde gastou mais, onde melhorou ou o que entrou na compra. */
function highlightText(comparison: ReceiptComparison, currency: string): string {
  let text = '';
  if (comparison.topIncrease) {
    const { description, previousPrice, currentPrice } = comparison.topIncrease;
    text += ` Onde voce gastou mais: ${description}, que foi de ${formatAmount(previousPrice, currency)} para ${formatAmount(currentPrice, currency)}.`;
  }
  if (comparison.topDecrease) {
    text += ` Onde voce ja melhorou: ${comparison.topDecrease.description} ficou mais barato, ajudando a segurar o total.`;
  } else if (comparison.itemsRemoved.length > 0 && comparison.deltaAmount <= 0) {
    text += ` Deixar de levar ${comparison.itemsRemoved.slice(0, 2).join(' e ')} ajudou a segurar o gasto — bom espaco pra repetir.`;
  } else if (comparison.itemsAdded.length > 0) {
    text += ` Novo nessa compra: ${comparison.itemsAdded.slice(0, 2).join(', ')}.`;
  }
  return text;
}

export function describeReceiptComparison(
  comparison: ReceiptComparison,
  otherGroupsCount: number,
  currency: string,
): string {
  const currentAmount = formatAmount(comparison.currentTotal, currency);
  const previousAmount = formatAmount(comparison.previousTotal, currency);
  // O grupo pode ter notas de estabelecimentos diferentes (ex.: "Compras do
  // mes" cobrindo mais de um mercado). So cita o nome quando ele existe e
  // ajuda a identificar a nota — nunca repete o mesmo nome duas vezes.
  const currentSuffix = comparison.currentMerchant ? ` (${comparison.currentMerchant})` : '';
  const previousSuffix =
    comparison.previousMerchant && comparison.previousMerchant !== comparison.currentMerchant
      ? ` (${comparison.previousMerchant})`
      : '';

  let message = `Na comparacao do grupo ${comparison.tagGroupName}, a nota mais recente${currentSuffix} ficou em ${currentAmount}${trendText(comparison)} em relacao a nota anterior${previousSuffix} de ${previousAmount}.`;
  message += highlightText(comparison, currency);
  if (otherGroupsCount > 0) {
    message += ` Tambem notei variacao em outro${otherGroupsCount > 1 ? 's' : ''} ${otherGroupsCount} grupo${otherGroupsCount > 1 ? 's' : ''} com comparacao ativada.`;
  }
  return message;
}
