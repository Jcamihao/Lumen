import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCreditCardDto } from './create-credit-card.dto';
import { ListCreditCardsQueryDto } from './list-credit-cards.query.dto';
import { UpdateCreditCardDto } from './update-credit-card.dto';

const ok = async (cls: any, body: object) => (await validate(plainToInstance(cls, body))).length === 0;

describe('DTOs de cartao', () => {
  describe('criar', () => {
    it('aceita o minimo, os limites e dueDay nulo', async () => {
      expect(await ok(CreateCreditCardDto, { name: 'N', closingDay: 1 })).toBe(true);
      expect(await ok(CreateCreditCardDto, { name: 'a'.repeat(40), closingDay: 31, dueDay: 31 })).toBe(true);
      expect(await ok(CreateCreditCardDto, { name: 'Inter', closingDay: 10, dueDay: null })).toBe(true);
    });

    it('recusa dia de fechamento fora de 1..31, nao inteiro ou ausente', async () => {
      for (const closingDay of [0, 32, 40, -1, 1.5, '5x']) {
        expect(await ok(CreateCreditCardDto, { name: 'X', closingDay })).toBe(false);
      }
      expect(await ok(CreateCreditCardDto, { name: 'X' })).toBe(false);
    });

    it('recusa vencimento fora de 1..31', async () => {
      for (const dueDay of [0, 32]) expect(await ok(CreateCreditCardDto, { name: 'X', closingDay: 5, dueDay })).toBe(false);
    });

    it('nome: 1 a 40 caracteres depois de aparado', async () => {
      expect(await ok(CreateCreditCardDto, { name: 'a'.repeat(41), closingDay: 5 })).toBe(false);
      expect(await ok(CreateCreditCardDto, { name: '   ', closingDay: 5 })).toBe(false);
      expect(await ok(CreateCreditCardDto, { name: '', closingDay: 5 })).toBe(false);
      expect(await ok(CreateCreditCardDto, { name: 12, closingDay: 5 })).toBe(false);
      expect(plainToInstance(CreateCreditCardDto, { name: '  Nu  ', closingDay: 5 }).name).toBe('Nu');
    });

    it('countAllPayments precisa ser booleano', async () => {
      expect(await ok(CreateCreditCardDto, { name: 'X', closingDay: 5, countAllPayments: 'sim' })).toBe(false);
    });
  });

  describe('editar', () => {
    it('aceita vazio, limites e dueDay nulo; recusa fora da faixa', async () => {
      expect(await ok(UpdateCreditCardDto, {})).toBe(true);
      expect(await ok(UpdateCreditCardDto, { closingDay: 1 })).toBe(true);
      expect(await ok(UpdateCreditCardDto, { closingDay: 31, dueDay: null })).toBe(true);
      for (const closingDay of [0, 32, -5]) expect(await ok(UpdateCreditCardDto, { closingDay })).toBe(false);
      for (const dueDay of [0, 32]) expect(await ok(UpdateCreditCardDto, { dueDay })).toBe(false);
      expect(await ok(UpdateCreditCardDto, { name: 'a'.repeat(41) })).toBe(false);
      expect(await ok(UpdateCreditCardDto, { name: '  ' })).toBe(false);
      expect(await ok(UpdateCreditCardDto, { countAllPayments: 'x' })).toBe(false);
    });
  });

  describe('listar', () => {
    it('includeArchived so aceita "true" ou "false"', async () => {
      expect(await ok(ListCreditCardsQueryDto, {})).toBe(true);
      expect(await ok(ListCreditCardsQueryDto, { includeArchived: 'true' })).toBe(true);
      expect(await ok(ListCreditCardsQueryDto, { includeArchived: 'false' })).toBe(true);
      expect(await ok(ListCreditCardsQueryDto, { includeArchived: 'talvez' })).toBe(false);
      expect(await ok(ListCreditCardsQueryDto, { includeArchived: '1' })).toBe(false);
    });
  });
});
