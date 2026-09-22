import { PaymentMethod } from '../models/domain.models';

export type PaymentMethodOption = { value: PaymentMethod; label: string; icon: string };

export const PAYMENT_METHODS: PaymentMethodOption[] = [
  { value: 'PIX', label: 'PIX', icon: 'bolt' },
  { value: 'CREDIT', label: 'Crédito', icon: 'credit_card' },
  { value: 'DEBIT', label: 'Débito', icon: 'payments' },
];

/** null quando nao foi informado (lancamentos antigos, importados ou sem escolha). */
export function paymentMethodLabel(method: string | null | undefined) {
  return PAYMENT_METHODS.find((option) => option.value === method)?.label ?? null;
}
