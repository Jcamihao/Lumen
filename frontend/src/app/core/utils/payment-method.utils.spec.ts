import { PAYMENT_METHODS, paymentMethodLabel } from './payment-method.utils';

describe('payment method utils', () => {
  it('oferece exatamente PIX, Credito e Debito, nessa ordem', () => {
    expect(PAYMENT_METHODS.map((option) => option.value)).toEqual(['PIX', 'CREDIT', 'DEBIT']);
    expect(PAYMENT_METHODS.map((option) => option.label)).toEqual(['PIX', 'Crédito', 'Débito']);
  });

  it('rotula cada forma de pagamento', () => {
    expect(paymentMethodLabel('PIX')).toBe('PIX');
    expect(paymentMethodLabel('CREDIT')).toBe('Crédito');
    expect(paymentMethodLabel('DEBIT')).toBe('Débito');
  });

  it('nao inventa rotulo para "nao informado" nem para valor desconhecido', () => {
    expect(paymentMethodLabel(null)).toBeNull();
    expect(paymentMethodLabel(undefined)).toBeNull();
    expect(paymentMethodLabel('')).toBeNull();
    expect(paymentMethodLabel('BOLETO')).toBeNull();
  });
});
