import { PRINCIPAL_CARD_NAME } from "../../credit-cycle/credit-cycle.util";

const DEFAULT_CLOSING_DAY = 30;
const FIRST_DAY_OF_MONTH = 1;
const LAST_DAY_OF_MONTH = 31;

export function buildPrincipalCardData(userId: string, monthClosingDay: number | undefined) {
  const requestedDay = monthClosingDay ?? DEFAULT_CLOSING_DAY;
  return {
    userId,
    name: PRINCIPAL_CARD_NAME,
    closingDay: Math.min(LAST_DAY_OF_MONTH, Math.max(FIRST_DAY_OF_MONTH, requestedDay)),
    dueDay: null,
    countAllPayments: false,
    isDefault: true,
  };
}
