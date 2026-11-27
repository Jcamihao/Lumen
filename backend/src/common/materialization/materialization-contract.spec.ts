import { Prisma, RecurrenceFrequency, TransactionType } from '@prisma/client';
import { InstallmentMaterializerService } from '../../installments/installment-materializer.service';
import { RecurringMaterializerService } from '../../recurring-transactions/recurring-materializer.service';
import { utcDate } from '../../recurring-transactions/recurrence.util';

const now = new Date('2026-09-20T20:00:00.000Z');
const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });

const recurring = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1', userId: 'user-1', type: TransactionType.EXPENSE, description: 'Aluguel', amount: 1200,
  frequency: RecurrenceFrequency.MONTHLY, anchorDay: 5, nextDueDate: utcDate(2026, 8, 5),
  endDate: null, isActive: true, ...over,
});
const plan = (over: Record<string, unknown> = {}) => ({
  id: 'plan-1', userId: 'user-1', description: 'iPhone', totalAmount: new Prisma.Decimal(6000),
  installmentAmount: new Prisma.Decimal(100), installmentsTotal: 60, installmentsGenerated: 0,
  anchorDay: 5, nextDueDate: utcDate(2026, 8, 5), isActive: true, ...over,
});

type Kind = 'recurring' | 'installment';
const kinds: [Kind, string, any, any][] = [
  ['recurring', 'recurringTransaction', RecurringMaterializerService, recurring],
  ['installment', 'installmentPurchase', InstallmentMaterializerService, plan],
];

/** Prisma falso: o tx e o cliente de fora sao mocks distintos, pra provar quem foi chamado. */
function build(model: string, row: unknown, opts: { user?: unknown; txError?: Error; fallbackCount?: number } = {}) {
  const txClaim = jest.fn().mockResolvedValue({ count: 1 });
  const create = jest.fn().mockResolvedValue({});
  const outerClaim = jest.fn().mockResolvedValue({ count: opts.fallbackCount ?? 1 });
  const tx = { [model]: { updateMany: txClaim }, transaction: { create } };
  const prisma = {
    [model]: { findMany: jest.fn().mockResolvedValue([row]), updateMany: outerClaim },
    user: { findUnique: jest.fn().mockResolvedValue('user' in opts ? opts.user : { timezone: 'UTC' }) },
    $transaction: jest.fn((cb: any) => (opts.txError ? Promise.reject(opts.txError) : cb(tx))),
  };
  return { prisma, txClaim, create, outerClaim };
}

it('conta fixa: ultimo vencimento encerra pela propria reivindicacao, sem segunda escrita', async () => {
  const row = recurring({ nextDueDate: utcDate(2026, 6, 5), endDate: utcDate(2026, 7, 5) });
  const { prisma, txClaim, outerClaim } = build('recurringTransaction', row);

  expect(await new RecurringMaterializerService(prisma as any).materializeDue('user-1', now)).toBe(2);
  expect(txClaim).toHaveBeenCalledTimes(2);
  expect(outerClaim).not.toHaveBeenCalled();
});

describe.each(kinds)('%s materializer (contrato do dinheiro)', (_kind, model, Service, make) => {
  const run = (prisma: unknown) => new Service(prisma as any).materializeDue('user-1', now);

  it('teto por rodada e exatamente 24 vencimentos', async () => {
    const { prisma, create } = build(model, make({ nextDueDate: utcDate(2020, 0, 5) }));
    prisma.$transaction.mockImplementation((cb: any) => cb({ [model]: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, transaction: { create } }));

    expect(await run(prisma)).toBe(24);
    expect(create).toHaveBeenCalledTimes(24);
  });

  it('sem fuso cadastrado usa UTC (amanha em Toquio nao vence)', async () => {
    const { prisma, create } = build(model, make({ nextDueDate: utcDate(2026, 8, 21) }), { user: null });

    expect(await run(prisma)).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('candidatas: vencimento ate amanha (agora + 1 dia), nem antes nem depois', async () => {
    const { prisma } = build(model, make());

    await run(prisma);

    const where = (prisma as any)[model].findMany.mock.calls[0][0].where;
    expect(where.nextDueDate.lte.getTime()).toBe(now.getTime() + 24 * 60 * 60 * 1000);
  });

  it('reivindica dentro da transacao e nunca pelo cliente de fora', async () => {
    const { prisma, txClaim, outerClaim, create } = build(model, make({ endDate: utcDate(2026, 8, 5) }));

    expect(await run(prisma)).toBe(1);
    expect(txClaim).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(outerClaim).not.toHaveBeenCalled();
  });

  it('P2002 e outra chamada levou o vencimento: para na hora, sem contar nem tentar o proximo', async () => {
    const { prisma, outerClaim } = build(model, make({ nextDueDate: utcDate(2026, 6, 5) }), { txError: p2002, fallbackCount: 0 });

    expect(await run(prisma)).toBe(0);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(outerClaim).toHaveBeenCalledTimes(1);
  });
});
