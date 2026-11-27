import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { GeneratedInsight, ReceiptScanSnapshot } from '../insight.types';
import { hashSubject } from '../insight-identity';
import { compareReceipts, ReceiptComparison } from './receipt-compare';
import { describeReceiptComparison } from './receipt-comparison.message';

/** Alta o suficiente pra virar aviso, ou critica, de aumento de gasto no mesmo estabelecimento. */
const TOTAL_WARNING_PCT = 0.15;
const TOTAL_CRITICAL_PCT = 0.4;

function groupByTagGroup(scans: ReceiptScanSnapshot[]): ReceiptScanSnapshot[][] {
  const byGroup = new Map<string, ReceiptScanSnapshot[]>();
  for (const scan of scans) {
    const group = byGroup.get(scan.tagGroupId);
    if (group) {
      group.push(scan);
    } else {
      byGroup.set(scan.tagGroupId, [scan]);
    }
  }
  return [...byGroup.values()];
}

function severityFor(deltaPercent: number | null): InsightSeverity {
  if (deltaPercent !== null && deltaPercent >= TOTAL_CRITICAL_PCT) return InsightSeverity.CRITICAL;
  if (deltaPercent !== null && deltaPercent >= TOTAL_WARNING_PCT) return InsightSeverity.WARNING;
  return InsightSeverity.INFO;
}

const comparisonMetadata = (entry: ReceiptComparison) => ({
  tagGroup: entry.tagGroupName,
  currentMerchant: entry.currentMerchant,
  previousMerchant: entry.previousMerchant,
  previousTotal: entry.previousTotal,
  currentTotal: entry.currentTotal,
  deltaAmount: entry.deltaAmount,
  deltaPercent: entry.deltaPercent,
  topIncrease: entry.topIncrease,
  topDecrease: entry.topDecrease,
  itemsAdded: entry.itemsAdded,
  itemsRemoved: entry.itemsRemoved,
});

/**
 * Compara a ultima nota fiscal de um grupo de tags com a anterior do mesmo
 * grupo: subiu ou caiu no total, qual item pesou mais, qual ficou mais
 * barato, o que entrou e o que saiu da lista.
 *
 * O grupo, escolhido pelo usuario antes do upload, e quem define o que e
 * comparavel com o que — nao o nome do estabelecimento. Duas notas so
 * comparam se estiverem no mesmo grupo, e so quando a nota mais recente do
 * par pediu a comparacao (compareWithPrevious): a comparacao e opcional,
 * nao automatica so por existir um par no mesmo grupo.
 */
export function detectReceiptComparison(context: InsightContext): GeneratedInsight | null {
  const comparisons = groupByTagGroup(context.recentReceiptScans)
    .filter((scans) => scans.length >= 2 && scans[0].compareWithPrevious)
    // recentReceiptScans ja vem ordenado por purchaseDate desc da query.
    .map(([current, previous]) => compareReceipts(current, previous))
    .sort((a, b) => Math.abs(b.deltaPercent ?? 0) - Math.abs(a.deltaPercent ?? 0));
  if (comparisons.length === 0) return null;

  const lead = comparisons[0];
  return {
    type: InsightType.FINANCE,
    key: `receipt_comparison:${hashSubject(comparisons.map((entry) => entry.tagGroupId))}`,
    severity: severityFor(lead.deltaPercent),
    message: describeReceiptComparison(lead, comparisons.length - 1, context.user.preferredCurrency),
    metadata: { comparisons: comparisons.map(comparisonMetadata) },
  };
}
