import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto';
import { ListTransactionsQueryDto } from './list-transactions-query.dto';
import { UpdateTransactionDto } from './update-transaction.dto';

const base = { type: 'EXPENSE', description: 'Mercado', amount: 10, date: '2026-09-10', paymentMethod: 'CREDIT' };
const UUID = '11111111-1111-4111-8111-111111111111';

describe('cardId nos DTOs de lancamento', () => {
  it('aceita UUID, ausencia; recusa texto livre', async () => {
    expect(await validate(plainToInstance(CreateTransactionDto, { ...base, cardId: UUID }))).toHaveLength(0);
    expect(await validate(plainToInstance(CreateTransactionDto, base))).toHaveLength(0);
    expect(await validate(plainToInstance(CreateTransactionDto, { ...base, cardId: 'nubank' }))).not.toHaveLength(0);
  });

  it('na edicao aceita null (limpar) e ausente; recusa texto', async () => {
    expect(await validate(plainToInstance(UpdateTransactionDto, { cardId: null }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateTransactionDto, {}))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateTransactionDto, { cardId: UUID }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateTransactionDto, { cardId: 'x' }))).not.toHaveLength(0);
  });

  it('filtro da listagem valida o cardId como UUID', async () => {
    expect(await validate(plainToInstance(ListTransactionsQueryDto, { cardId: UUID }))).toHaveLength(0);
    expect(await validate(plainToInstance(ListTransactionsQueryDto, { cardId: 'x' }))).not.toHaveLength(0);
  });
});
