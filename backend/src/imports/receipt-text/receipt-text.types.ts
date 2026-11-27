export type ReceiptTextItem = {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number;
  lineConsistent: boolean;
};

export type ReceiptTotalMismatch = { itemsSum: number; total: number; difference: number };

export type ParsedAccessKey = {
  key: string;
  ufCode: string;
  year: number;
  month: number;
  cnpj: string;
  model: string;
  series: string;
  number: string;
};

export type ParsedReceiptText = {
  merchantName: string | null;
  cnpj: string | null;
  cnpjSource: 'KEY' | 'TEXT' | null;
  accessKey: string | null;
  accessKeyValid: boolean;
  documentNumber: string | null;
  purchaseDate: Date | null;
  totalAmount: number | null;
  items: ReceiptTextItem[];
  itemsSum: number | null;
  totalMismatch: ReceiptTotalMismatch | null;
  warnings: string[];
  rawTextRedacted: string;
};

export type ParseReceiptOptions = { today: Date; qrAccessKey?: string | null };
