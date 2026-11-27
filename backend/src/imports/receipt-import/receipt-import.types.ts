export type NormalizedReceiptItem = {
  description: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
  categoryHint: string | null;
};

export type ReceiptPreviewData = {
  notes: string[];
  rawTextExcerpt: string | null;
  possibleDuplicate: boolean;
  duplicateTransactionId: string | null;
  duplicateTransactionDescription: string | null;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  documentType: string | null;
  merchantTaxId: string | null;
  accessKey: string | null;
  qrCodeDetected: boolean;
  qrCodeText: string | null;
  itemCategoryHints: Array<string | null>;
  itemsSum?: number | null;
  totalMismatch?: { itemsSum: number; total: number; difference: number } | null;
  extraction?: {
    method: string;
    ocrConfidence: number | null;
    warnings: string[];
    qrDetected: boolean;
    secondPass: boolean;
  } | null;
  accessKeyValid?: boolean;
  purchaseSummary: string | null;
  purchaseMission: string | null;
  spendingSignals: string[];
  followUpActions: string[];
  provider: string | null;
  model: string | null;
  generatedAt: string | null;
};

export type ReceiptCategoryBreakdownItem = {
  label: string;
  totalAmount: number;
  itemCount: number;
};

export type ReceiptItemPriceHistoryEntry = {
  merchantName: string | null;
  purchaseDate: string | null;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
};

export type ReceiptItemPriceComparison = {
  matchKey: string;
  historyCount: number;
  lowestUnitPrice: number;
  averageUnitPrice: number;
  latestUnitPrice: number;
  cheapestMerchantName: string | null;
  cheapestPurchaseDate: string | null;
  currentUnitPrice: number | null;
  currentVsLowestAmount: number | null;
  currentVsLowestPercent: number | null;
  history: ReceiptItemPriceHistoryEntry[];
};

export type PriceableItem = {
  description: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
};

export type ExpenseCategoryRef = { id: string; name: string };
