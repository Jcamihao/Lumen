import { CreditCard } from '../models/domain.models';
import { activeCards, cardIdForPayload, ceilingError, isCreditExpense, isUncertainSave, pickCardId } from './credit-card.utils';

const card = (overrides: Partial<CreditCard> = {}): CreditCard => ({
  id: 'c-principal',
  name: 'Principal',
  closingDay: 5,
  dueDay: null,
  countAllPayments: false,
  isDefault: true,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const nubank = card({ id: 'c-nubank', name: 'Nubank', isDefault: false });
const inter = card({ id: 'c-inter', name: 'Inter', isDefault: false });

describe('credit-card.utils', () => {
  describe('activeCards', () => {
    it('tira arquivados e coloca o padrao primeiro, depois por nome', () => {
      const archived = card({ id: 'c-old', name: 'Antigo', isDefault: false, archivedAt: '2026-02-01T00:00:00.000Z' });

      expect(activeCards([nubank, archived, inter, card()]).map((c) => c.id)).toEqual(['c-principal', 'c-inter', 'c-nubank']);
    });
  });

  describe('isCreditExpense', () => {
    it('so despesa no credito', () => {
      expect(isCreditExpense('EXPENSE', 'CREDIT')).toBeTrue();
      expect(isCreditExpense('INCOME', 'CREDIT')).toBeFalse();
      expect(isCreditExpense('TRANSFER', 'CREDIT')).toBeFalse();
      expect(isCreditExpense('EXPENSE', 'PIX')).toBeFalse();
      expect(isCreditExpense('EXPENSE', 'DEBIT')).toBeFalse();
      expect(isCreditExpense('EXPENSE', '')).toBeFalse();
      expect(isCreditExpense('EXPENSE', null)).toBeFalse();
    });
  });

  describe('pickCardId', () => {
    it('vazio quando o seletor nao vale (nao selecionavel)', () => {
      expect(pickCardId('', [card(), nubank], false)).toBe('');
      expect(pickCardId('c-nubank', [card(), nubank], false)).toBe('');
    });

    it('vazio com um cartao so ativo (o servidor usa o padrao)', () => {
      expect(pickCardId('', [card()], true)).toBe('');
      expect(pickCardId('', [card(), card({ id: 'c-old', archivedAt: '2026-02-01T00:00:00.000Z', isDefault: false })], true)).toBe('');
    });

    it('com dois ou mais: vem o padrao quando nao ha escolha', () => {
      expect(pickCardId('', [nubank, card()], true)).toBe('c-principal');
    });

    it('mantem a escolha valida', () => {
      expect(pickCardId('c-nubank', [nubank, card()], true)).toBe('c-nubank');
    });

    it('volta ao padrao quando a escolha nao e um cartao ativo', () => {
      expect(pickCardId('c-sumiu', [nubank, card()], true)).toBe('c-principal');
    });

    it('sem padrao marcado, volta ao primeiro ativo', () => {
      expect(pickCardId('', [nubank, inter], true)).toBe('c-inter');
    });
  });

  describe('ceilingError', () => {
    it('aceita o limite do servidor e recusa acima dele', () => {
      expect(ceilingError(9_999_999_999)).toBeNull();
      expect(ceilingError(10_000_000_000)).toBe('Use um valor menor que dez bilhões.');
    });
  });

  describe('isUncertainSave', () => {
    it('sem resposta (0) e 5xx sao desconhecidos; 4xx nao', () => {
      expect(isUncertainSave({ status: 0 })).toBeTrue();
      expect(isUncertainSave({ status: 500 })).toBeTrue();
      expect(isUncertainSave({ status: 503 })).toBeTrue();
      expect(isUncertainSave({ status: 400 })).toBeFalse();
      expect(isUncertainSave({ status: 409 })).toBeFalse();
    });
  });

  describe('cardIdForPayload', () => {
    it('so envia quando e credito e despesa e ha cartao', () => {
      expect(cardIdForPayload('c-nubank', true)).toBe('c-nubank');
      expect(cardIdForPayload('c-nubank', false)).toBeUndefined();
      expect(cardIdForPayload('', true)).toBeUndefined();
    });
  });
});
