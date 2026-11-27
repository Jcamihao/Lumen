const TRUE_VALUES = ['1', 'true', 'yes', 'on'];
const MIN_TIMEOUT_MS = 15000;
const DEFAULT_TIMEOUT_MS = 60000;

export function readEnv(key: string): string | null {
  return String(process.env[key] || '').trim() || null;
}

export function readBooleanEnv(key: string): boolean {
  return TRUE_VALUES.includes(String(process.env[key] || '').trim().toLowerCase());
}

export function readReceiptTimeout(): number {
  const configured = process.env.SELAH_RECEIPT_TIMEOUT_MS || process.env.SELAH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Number(configured));
}
