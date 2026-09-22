import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto';
import { ListTransactionsQueryDto } from './list-transactions-query.dto';
import { UpdateTransactionDto } from './update-transaction.dto';

const base = { type: 'EXPENSE', description: 'Mercado', amount: 10, date: '2026-09-10' };

describe('forma de pagamento — validacao', () => {
  it.each(['PIX', 'CREDIT', 'DEBIT'])('aceita %s ao criar', async (paymentMethod) => {
    const errors = await validate(plainToInstance(CreateTransactionDto, { ...base, paymentMethod }));

    expect(errors).toHaveLength(0);
  });

  it('e opcional ao criar', async () => {
    expect(await validate(plainToInstance(CreateTransactionDto, base))).toHaveLength(0);
  });

  it('recusa valor fora da lista (nada de texto livre no banco)', async () => {
    for (const paymentMethod of ['BOLETO', 'pix', 'cash', '']) {
      const errors = await validate(plainToInstance(CreateTransactionDto, { ...base, paymentMethod }));
      expect(errors).not.toHaveLength(0);
    }
  });

  it('na edicao aceita null (limpar) e ausente', async () => {
    expect(await validate(plainToInstance(UpdateTransactionDto, { paymentMethod: null }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateTransactionDto, {}))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateTransactionDto, { paymentMethod: 'PIX' }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateTransactionDto, { paymentMethod: 'X' }))).not.toHaveLength(0);
  });

  it('o filtro da lista valida o valor', async () => {
    expect(await validate(plainToInstance(ListTransactionsQueryDto, { paymentMethod: 'CREDIT' }))).toHaveLength(0);
    expect(await validate(plainToInstance(ListTransactionsQueryDto, { paymentMethod: 'DINHEIRO' }))).not.toHaveLength(0);
  });
});
