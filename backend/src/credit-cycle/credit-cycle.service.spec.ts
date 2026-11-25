import { Prisma } from '@prisma/client';
import { CreditCycleService } from './credit-cycle.service';
import { CreditLimitChangedError, CreditLimitWriteUncertainError } from './conversation-write.types';
import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

const decimal = (value: number) => new Prisma.Decimal(value);

describe('CreditCycleService', () => {
  const build = (options: {
    monthClosingDay?: number;
    creditDueDay?: number | null;
    countAllPayments?: boolean;
    ceilingRow?: { ceiling: any; id?: string } | null;
    previousCeilingRow?: { ceiling: any } | null;
    spentSum?: number | null;
    timezone?: string;
    extraCards?: Array<Record<string, unknown>>;
  } = {}) => {
    // Cartao padrao do user-1 e uma lista de cartoes com dono (isolamento).
    const card: Record<string, unknown> = {
      id: 'card-1',
      userId: 'user-1',
      name: 'Principal',
      closingDay: options.monthClosingDay ?? 5,
      dueDay: options.creditDueDay ?? null,
      countAllPayments: options.countAllPayments ?? false,
      isDefault: true,
      archivedAt: null,
    };
    const cards: Array<Record<string, any>> = [card, ...(options.extraCards ?? [])];
    const pick = (where: any) =>
      cards.find(
        (c) =>
          (where.id === undefined || c.id === where.id) &&
          (where.userId === undefined || c.userId === where.userId) &&
          (where.isDefault === undefined || c.isDefault === where.isDefault) &&
          (where.archivedAt === undefined || c.archivedAt === where.archivedAt),
      ) ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma: any = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          timezone: options.timezone ?? 'America/Sao_Paulo',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      creditCard: {
        findFirst: jest.fn(async ({ where }) => pick(where)),
        update: jest.fn(async ({ where, data }) => {
          const target = cards.find((c) => c.id === where.id)!;
          Object.assign(target, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
          return { ...target };
        }),
      },
      creditCycleCeiling: {
        findUnique: jest.fn().mockResolvedValue(options.ceilingRow ?? null),
        findFirst: jest.fn().mockResolvedValue(options.previousCeilingRow ?? null),
        upsert: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      transaction: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: options.spentSum ?? null } }),
      },
    };
    // Transação interativa em memória: o callback recebe o mesmo cliente fake.
    Object.assign(prisma, {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    });
    const lifeEngine = { touchUserData: jest.fn().mockResolvedValue(undefined) };
    const service = new CreditCycleService(prisma as any, lifeEngine as any);

    return { service, prisma, lifeEngine };
  };

  describe('getCurrent', () => {
    it('sem teto definido: status "none", sem percentual nem restante', async () => {
      const { service } = build();

      const result = await service.getCurrent('user-1');

      expect(result.status).toBe('none');
      expect(result.ceiling).toBeNull();
      expect(result.percentUsed).toBeNull();
      expect(result.remaining).toBeNull();
    });

    it('por padrao (countAllPayments=false) so busca EXPENSE + CREDIT dentro do ciclo', async () => {
      const { service, prisma } = build();

      await service.getCurrent('user-1');

      expect(prisma.transaction.aggregate.mock.calls[0][0].where).toMatchObject({
        userId: 'user-1',
        type: 'EXPENSE',
        paymentMethod: 'CREDIT',
      });
    });

    it('com countAllPayments=true, busca toda EXPENSE do ciclo sem filtrar forma de pagamento', async () => {
      const { service, prisma } = build({ countAllPayments: true });

      await service.getCurrent('user-1');

      const where = prisma.transaction.aggregate.mock.calls[0][0].where;
      expect(where).toMatchObject({ userId: 'user-1', type: 'EXPENSE' });
      expect(where.paymentMethod).toBeUndefined();
    });

    it('devolve countAllPayments junto (reflete a config do usuario)', async () => {
      const { service } = build({ countAllPayments: true });

      expect((await service.getCurrent('user-1')).countAllPayments).toBe(true);
    });

    it('abaixo de 80%: status "ok"', async () => {
      const { service } = build({ ceilingRow: { ceiling: decimal(1000) }, spentSum: 700 });

      const result = await service.getCurrent('user-1');

      expect(result.status).toBe('ok');
      expect(result.percentUsed).toBe(70);
      expect(result.remaining).toBe(300);
    });

    it('80% ou mais: status "near"', async () => {
      const { service } = build({ ceilingRow: { ceiling: decimal(1000) }, spentSum: 840 });

      const result = await service.getCurrent('user-1');

      expect(result.status).toBe('near');
      expect(result.percentUsed).toBe(84);
    });

    it('100% ou mais: status "over", com restante negativo', async () => {
      const { service } = build({ ceilingRow: { ceiling: decimal(1000) }, spentSum: 1120 });

      const result = await service.getCurrent('user-1');

      expect(result.status).toBe('over');
      expect(result.percentUsed).toBe(112);
      expect(result.remaining).toBe(-120);
    });

    it('exatamente 100% conta como estourado', async () => {
      const { service } = build({ ceilingRow: { ceiling: decimal(1000) }, spentSum: 1000 });

      expect((await service.getCurrent('user-1')).status).toBe('over');
    });

    it('percentual arredonda pra baixo (como o orcamento por categoria)', async () => {
      const { service } = build({ ceilingRow: { ceiling: decimal(1000) }, spentSum: 799.9 });

      expect((await service.getCurrent('user-1')).percentUsed).toBe(79);
    });

    it('sugere o teto do ciclo anterior quando o atual ainda nao tem um', async () => {
      const { service } = build({ previousCeilingRow: { ceiling: decimal(1500) } });

      const result = await service.getCurrent('user-1');

      expect(result.ceiling).toBeNull();
      expect(result.previousCeiling).toBe(1500);
    });

    it('o teto sugerido vem so de ciclos anteriores (estritamente antes do fechamento atual)', async () => {
      const { service, prisma } = build({ previousCeilingRow: { ceiling: decimal(1500) } });

      await service.getCurrent('user-1');

      const where = prisma.creditCycleCeiling.findFirst.mock.calls[0][0].where;
      expect(where.closingDate).toHaveProperty('lt');
      expect(where.closingDate).not.toHaveProperty('lte');
    });

    it('devolve o dia de vencimento junto (so informativo)', async () => {
      const { service } = build({ creditDueDay: 15 });

      expect((await service.getCurrent('user-1')).dueDay).toBe(15);
    });
  });

  describe('updateSettings', () => {
    it('grava o dia de vencimento no cartao padrao, sem tocar no User (9c-2)', async () => {
      const { service, prisma } = build();

      await service.updateSettings('user-1', { dueDay: 12 });

      expect(prisma.creditCard.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'card-1' },
        data: { dueDay: 12 },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('null limpa o dia de vencimento', async () => {
      const { service, prisma } = build();

      await service.updateSettings('user-1', { dueDay: null });

      expect(prisma.creditCard.update.mock.calls[0][0].data.dueDay).toBeNull();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('recalcula os insights apos mudar as configuracoes', async () => {
      const { service, lifeEngine } = build();

      await service.updateSettings('user-1', { dueDay: 10 });

      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
    });

    it('grava countAllPayments no cartao, sem espelho no User', async () => {
      const { service, prisma } = build();

      await service.updateSettings('user-1', { countAllPayments: true });

      expect(prisma.creditCard.update.mock.calls[0][0].data.countAllPayments).toBe(true);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('nao mexe em countAllPayments quando nao enviado (so o dueDay)', async () => {
      const { service, prisma } = build();

      await service.updateSettings('user-1', { dueDay: 5 });

      expect(prisma.creditCard.update.mock.calls[0][0].data.countAllPayments).toBeUndefined();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('setCeiling', () => {
    it('grava o teto do ciclo aberto agora (upsert por closingDate)', async () => {
      const { service, prisma } = build();

      await service.setCeiling('user-1', { ceiling: 1600 });

      const call = prisma.creditCycleCeiling.upsert.mock.calls[0][0];
      expect(call.where.cardId_closingDate.cardId).toBe('card-1');
      expect(Number(call.create.ceiling)).toBe(1600);
      expect(Number(call.update.ceiling)).toBe(1600);
    });

    it('recalcula os insights apos definir o teto', async () => {
      const { service, lifeEngine } = build();

      await service.setCeiling('user-1', { ceiling: 1600 });

      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
    });

    it('devolve o estado atualizado (reflete o teto recem-gravado)', async () => {
      const { service, prisma } = build();
      // Apos o upsert, uma nova leitura encontraria a linha: simula isso.
      prisma.creditCycleCeiling.findUnique.mockResolvedValue({ ceiling: decimal(1600) });

      const result = await service.setCeiling('user-1', { ceiling: 1600 });

      expect(result.ceiling).toBe(1600);
    });
  });

  describe('setCeilingForConversation (recibo do bot, bloqueio do dono)', () => {
    // Ciclo com fechamento no dia 5: em 15/11/2026 o ciclo é 06/11/2026 a 05/12/2026.
    const expected = {
      cycleStart: '2026-11-06',
      cycleEnd: '2026-12-05',
      previousCeilingCents: null,
      countAllPayments: false,
    };
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-15T12:00:00.000Z') }));
    afterEach(() => jest.useRealTimers());

    it('bloqueia a linha do dono antes de ler o ciclo, grava o teto e devolve o recibo', async () => {
      const { service, prisma } = build();
      prisma.creditCycleCeiling.upsert.mockResolvedValueOnce({ id: 'ceil-1', ceiling: decimal(5000) });

      const receipt = await service.setCeilingForConversation('user-1', { ceiling: 5000 }, expected);

      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.user.findUniqueOrThrow.mock.invocationCallOrder[0],
      );
      expect(prisma.creditCycleCeiling.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { cardId_closingDate: { cardId: 'card-1', closingDate: new Date('2026-12-05T00:00:00.000Z') } },
        }),
      );
      expect(receipt).toEqual({
        id: 'ceil-1',
        ceilingCents: 500000,
        cycleStart: '2026-11-06',
        cycleEnd: '2026-12-05',
        refreshPending: false,
      });
    });

    it('escopo do dono: bloqueio, leitura do usuário, leitura e escrita do teto usam só o userId autenticado', async () => {
      const { service, prisma } = build();
      prisma.creditCycleCeiling.upsert.mockResolvedValueOnce({ id: 'ceil-1', ceiling: decimal(5000) });
      const closingDate = new Date('2026-12-05T00:00:00.000Z');

      await service.setCeilingForConversation('user-1', { ceiling: 5000 }, expected);

      const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
      expect(strings.join('?')).toBe('SELECT "id" FROM "User" WHERE "id" = ? FOR NO KEY UPDATE');
      expect(values).toEqual(['user-1']);
      expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
      expect(prisma.creditCycleCeiling.findUnique).toHaveBeenCalledWith({
        where: { cardId_closingDate: { cardId: 'card-1', closingDate } },
      });
      expect(prisma.creditCycleCeiling.upsert).toHaveBeenCalledWith({
        where: { cardId_closingDate: { cardId: 'card-1', closingDate } },
        create: { cardId: 'card-1', userId: 'user-1', closingDate, ceiling: decimal(5000) },
        update: { ceiling: decimal(5000) },
      });
    });

    it('só o início do ciclo mudou: não grava', async () => {
      const { service, prisma } = build();

      const error = await service
        .setCeilingForConversation('user-1', { ceiling: 5000 }, { ...expected, cycleStart: '2026-11-05' })
        .catch((e) => e);

      expect(error).toBeInstanceOf(CreditLimitChangedError);
      expect(prisma.creditCycleCeiling.upsert).not.toHaveBeenCalled();
    });

    it('só o fim do ciclo mudou: não grava', async () => {
      const { service, prisma } = build();

      const error = await service
        .setCeilingForConversation('user-1', { ceiling: 5000 }, { ...expected, cycleEnd: '2026-12-04' })
        .catch((e) => e);

      expect(error).toBeInstanceOf(CreditLimitChangedError);
      expect(prisma.creditCycleCeiling.upsert).not.toHaveBeenCalled();
    });

    it('o recibo não depende de leitura posterior: gasto do ciclo falhando não afeta o limite gravado', async () => {
      const { service, prisma } = build();
      prisma.creditCycleCeiling.upsert.mockResolvedValueOnce({ id: 'ceil-1', ceiling: decimal(5000) });
      prisma.transaction.aggregate.mockRejectedValue(new Error('agregacao'));

      const receipt = await service.setCeilingForConversation('user-1', { ceiling: 5000 }, expected);

      expect(receipt).toMatchObject({ id: 'ceil-1', ceilingCents: 500000, refreshPending: false });
      expect(prisma.transaction.aggregate).not.toHaveBeenCalled();
    });

    // O snapshot observado na exibição (`expected`) é diferente do que o banco tem agora.
    it('ciclo mudou desde a exibição: não grava e devolve o ciclo atual', async () => {
      const { service, prisma } = build();

      const error = await service
        .setCeilingForConversation('user-1', { ceiling: 5000 }, { ...expected, cycleStart: '2026-10-06', cycleEnd: '2026-11-05' })
        .catch((e) => e);

      expect(error).toBeInstanceOf(CreditLimitChangedError);
      expect(error.current).toMatchObject({ cycleStart: '2026-11-06', cycleEnd: '2026-12-05' });
      expect(prisma.creditCycleCeiling.upsert).not.toHaveBeenCalled();
    });

    it('teto vigente mudou (tela gravou antes): não grava', async () => {
      const { service, prisma } = build({ ceilingRow: { ceiling: decimal(2000) } });

      const error = await service.setCeilingForConversation('user-1', { ceiling: 5000 }, expected).catch((e) => e);

      expect(error).toBeInstanceOf(CreditLimitChangedError);
      expect(error.current.previousCeilingCents).toBe(200000);
      expect(prisma.creditCycleCeiling.upsert).not.toHaveBeenCalled();
    });

    it('opção de todas as formas mudou na tela: não grava', async () => {
      const { service, prisma } = build({ countAllPayments: true });

      const error = await service.setCeilingForConversation('user-1', { ceiling: 5000 }, expected).catch((e) => e);

      expect(error).toBeInstanceOf(CreditLimitChangedError);
      expect(error.current.countAllPayments).toBe(true);
      expect(prisma.creditCycleCeiling.upsert).not.toHaveBeenCalled();
    });

    it('falha de commit depois do callback vira resultado desconhecido', async () => {
      const { service, prisma } = build();
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        await fn(prisma);
        throw new Error('conexao perdida');
      });

      await expect(service.setCeilingForConversation('user-1', { ceiling: 5000 }, expected)).rejects.toBeInstanceOf(
        CreditLimitWriteUncertainError,
      );
    });

    it('falha antes do upsert é erro comprovado, sem virar resultado desconhecido', async () => {
      const { service, prisma } = build();
      prisma.creditCycleCeiling.upsert.mockRejectedValueOnce(new Error('falha no upsert'));

      const error = await service.setCeilingForConversation('user-1', { ceiling: 5000 }, expected).catch((e) => e);

      expect(error.message).toBe('falha no upsert');
      expect(error).not.toBeInstanceOf(CreditLimitWriteUncertainError);
    });

    it('valor inválido é recusado antes de abrir a transação', async () => {
      const { service, prisma } = build();

      for (const ceiling of [0, 0.001, 10_000_000_000]) {
        await expect(service.setCeilingForConversation('user-1', { ceiling }, expected)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('falha ao atualizar dados derivados não desfaz o teto: refreshPending true', async () => {
      const { service, prisma, lifeEngine } = build();
      prisma.creditCycleCeiling.upsert.mockResolvedValueOnce({ id: 'ceil-2', ceiling: decimal(5000) });
      lifeEngine.touchUserData.mockRejectedValueOnce(new Error('insights'));

      const receipt = await service.setCeilingForConversation('user-1', { ceiling: 5000 }, expected);

      expect(receipt.refreshPending).toBe(true);
      expect(receipt.ceilingCents).toBe(500000);
    });
  });

  describe('setCeiling (tela) usa o mesmo núcleo', () => {
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-15T12:00:00.000Z') }));
    afterEach(() => jest.useRealTimers());

    it('grava dentro da transação e responde o estado atual', async () => {
      const { service, prisma } = build({ ceilingRow: { ceiling: decimal(5000) } });

      const response = await service.setCeiling('user-1', { ceiling: 5000 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(response.ceiling).toBe(5000);
    });
  });
describe('ciclo por cartao (9a-1)', () => {
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-15T12:00:00.000Z') }));
    afterEach(() => jest.useRealTimers());

    const nubank = { id: 'card-2', userId: 'user-1', name: 'Nubank', closingDay: 20, dueDay: 27, countAllPayments: false, isDefault: false, archivedAt: null };

    it('cartao nao padrao soma so CREDIT do proprio cartao e usa o fechamento dele', async () => {
      const { service, prisma } = build({ extraCards: [nubank] });

      const result = await service.getCycleForCard('user-1', 'card-2');

      const where = prisma.transaction.aggregate.mock.calls[0][0].where;
      expect(where).toMatchObject({ userId: 'user-1', type: 'EXPENSE', paymentMethod: 'CREDIT', cardId: 'card-2' });
      expect(where.OR).toBeUndefined();
      expect(result.closingDay).toBe(20);
      expect(result.dueDay).toBe(27);
      expect(result.cycleEnd).toBe('2026-11-20T00:00:00.000Z');
    });

    it('cartao padrao soma CREDIT com cardId igual ao dele ou nulo (lancamentos antigos)', async () => {
      const { service, prisma } = build();

      await service.getCycleForCard('user-1', 'card-1');

      const where = prisma.transaction.aggregate.mock.calls[0][0].where;
      expect(where).toMatchObject({ paymentMethod: 'CREDIT' });
      expect(where.OR).toEqual([{ cardId: 'card-1' }, { cardId: null, paymentMethod: 'CREDIT', type: 'EXPENSE' }]);
    });

    it('padrao com countAllPayments soma toda EXPENSE, sem filtro de cartao nem de forma de pagamento', async () => {
      const { service, prisma } = build({ countAllPayments: true });

      await service.getCurrent('user-1');

      const where = prisma.transaction.aggregate.mock.calls[0][0].where;
      expect(where.paymentMethod).toBeUndefined();
      expect(where.OR).toBeUndefined();
      expect(where.cardId).toBeUndefined();
    });

    it('cartao alheio responde 404 e o ciclo nao e lido', async () => {
      const alheio = { id: 'card-x', userId: 'user-2', name: 'Alheio', closingDay: 3, dueDay: null, countAllPayments: false, isDefault: false, archivedAt: null };
      const { service, prisma } = build({ extraCards: [alheio] });

      await expect(service.getCycleForCard('user-1', 'card-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.creditCard.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'card-x', userId: 'user-1' });
      expect(prisma.transaction.aggregate).not.toHaveBeenCalled();
    });

    it('sem cartao padrao ativo: falha de invariante, sem ler o ciclo', async () => {
      const { service, prisma } = build();
      prisma.creditCard.findFirst.mockResolvedValueOnce(null);

      await expect(service.getCurrent('user-1')).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(prisma.transaction.aggregate).not.toHaveBeenCalled();
    });

    it('teto de cartao nao padrao grava por cardId_closingDate do proprio cartao', async () => {
      const { service, prisma } = build({ extraCards: [nubank] });
      prisma.creditCycleCeiling.upsert.mockResolvedValueOnce({ id: 'ceil-9', ceiling: decimal(800) });

      const receipt = await service.setCeilingForCard('user-1', 'card-2', { ceiling: 800 });

      expect(prisma.creditCycleCeiling.upsert.mock.calls[0][0].where).toEqual({
        cardId_closingDate: { cardId: 'card-2', closingDate: new Date('2026-11-20T00:00:00.000Z') },
      });
      expect(receipt).toMatchObject({ id: 'ceil-9', ceilingCents: 80000, cycleEnd: '2026-11-20', refreshPending: false });
    });

    it('teto de cartao arquivado e recusado sem gravar', async () => {
      const arquivado = { ...nubank, archivedAt: new Date('2026-11-01T00:00:00.000Z') };
      const { service, prisma } = build({ extraCards: [arquivado] });

      await expect(service.setCeilingForCard('user-1', 'card-2', { ceiling: 800 })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.creditCycleCeiling.upsert).not.toHaveBeenCalled();
    });

    it('teto de cartao alheio responde 404 sem gravar', async () => {
      const alheio = { id: 'card-x', userId: 'user-2', name: 'Alheio', closingDay: 3, dueDay: null, countAllPayments: false, isDefault: false, archivedAt: null };
      const { service, prisma } = build({ extraCards: [alheio] });

      await expect(service.setCeilingForCard('user-1', 'card-x', { ceiling: 800 })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.creditCycleCeiling.upsert).not.toHaveBeenCalled();
    });
  });

  describe('removeCeilingForConversation (limpar teto do bot, 8d)', () => {
    const expected = {
      cycleStart: '2026-11-06',
      cycleEnd: '2026-12-05',
      previousCeilingCents: 200000,
      countAllPayments: false,
    };
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-15T12:00:00.000Z') }));
    afterEach(() => jest.useRealTimers());

    it('confere snapshot sob bloqueio e apaga a linha do teto do cartao no ciclo aberto', async () => {
      const { service, prisma } = build({ ceilingRow: { id: 'ceil-1', ceiling: decimal(2000) } });

      const receipt = await service.removeCeilingForConversation('user-1', expected, 'card-1');

      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.creditCycleCeiling.delete.mock.invocationCallOrder[0]);
      expect(prisma.creditCycleCeiling.delete).toHaveBeenCalledWith({ where: { id: 'ceil-1' } });
      expect(receipt).toEqual({ id: 'ceil-1', removedCents: 200000, cycleStart: '2026-11-06', cycleEnd: '2026-12-05', refreshPending: false });
    });

    it('remove no cartao escolhido pelo nome, nao no padrao', async () => {
      const extra = { id: 'card-2', userId: 'user-1', name: 'Nubank', closingDay: 5, dueDay: null, countAllPayments: false, isDefault: false, archivedAt: null };
      const { service, prisma } = build({ extraCards: [extra], ceilingRow: { id: 'ceil-2', ceiling: decimal(1200) } });

      const receipt = await service.removeCeilingForConversation('user-1', { ...expected, previousCeilingCents: 120000 }, 'card-2');

      expect(receipt.id).toBe('ceil-2');
      expect(receipt.removedCents).toBe(120000);
      expect(prisma.creditCycleCeiling.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cardId_closingDate: { cardId: 'card-2', closingDate: new Date('2026-12-05T00:00:00.000Z') } } }),
      );
    });

    it('teto mudou na tela no meio: conflito com o snapshot atual, sem apagar', async () => {
      const { service, prisma } = build({ ceilingRow: { id: 'ceil-1', ceiling: decimal(2500) } });

      const error = await service.removeCeilingForConversation('user-1', expected, 'card-1').catch((e) => e);

      expect(error).toBeInstanceOf(CreditLimitChangedError);
      expect(error.current.previousCeilingCents).toBe(250000);
      expect(prisma.creditCycleCeiling.delete).not.toHaveBeenCalled();
    });

    it('sem teto no ciclo (a tela removeu antes): conflito, nada a apagar', async () => {
      const { service, prisma } = build({ ceilingRow: null });

      await expect(service.removeCeilingForConversation('user-1', expected, 'card-1')).rejects.toBeInstanceOf(CreditLimitChangedError);
      expect(prisma.creditCycleCeiling.delete).not.toHaveBeenCalled();
    });

    it('rascunho sem teto previo (snapshot null) nunca chega ao delete', async () => {
      const { service, prisma } = build({ ceilingRow: null });

      await expect(
        service.removeCeilingForConversation('user-1', { ...expected, previousCeilingCents: null }, 'card-1'),
      ).rejects.toBeInstanceOf(CreditLimitChangedError);
      expect(prisma.creditCycleCeiling.delete).not.toHaveBeenCalled();
    });

    it('cartao alheio responde 404 e arquivado responde 409, sem apagar', async () => {
      const alheio = { id: 'card-x', userId: 'user-2', name: 'Alheio', closingDay: 3, dueDay: null, countAllPayments: false, isDefault: false, archivedAt: null };
      const arquivado = { id: 'card-2', userId: 'user-1', name: 'Velho', closingDay: 3, dueDay: null, countAllPayments: false, isDefault: false, archivedAt: new Date('2026-11-01T00:00:00.000Z') };
      const comAlheio = build({ extraCards: [alheio], ceilingRow: { id: 'ceil-1', ceiling: decimal(2000) } });
      await expect(comAlheio.service.removeCeilingForConversation('user-1', expected, 'card-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(comAlheio.prisma.creditCycleCeiling.delete).not.toHaveBeenCalled();

      const comArquivado = build({ extraCards: [arquivado], ceilingRow: { id: 'ceil-1', ceiling: decimal(2000) } });
      await expect(comArquivado.service.removeCeilingForConversation('user-1', expected, 'card-2')).rejects.toBeInstanceOf(ConflictException);
      expect(comArquivado.prisma.creditCycleCeiling.delete).not.toHaveBeenCalled();
    });

    it('queda no commit depois do delete: resultado desconhecido, nao erro simples', async () => {
      const { service, prisma } = build({ ceilingRow: { id: 'ceil-1', ceiling: decimal(2000) } });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        await fn(prisma);
        throw new Error('connection lost');
      });

      await expect(service.removeCeilingForConversation('user-1', expected, 'card-1')).rejects.toBeInstanceOf(CreditLimitWriteUncertainError);
    });
  });

  describe('fim do espelho no User (9c-2)', () => {
    it('updateSettings grava so o cartao padrao, na transacao depois do lock, e nao toca no User', async () => {
      const { service, prisma } = build();

      await service.updateSettings('user-1', { dueDay: 15, countAllPayments: true });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.creditCard.update.mock.invocationCallOrder[0]);
      expect(prisma.creditCard.update.mock.calls[0][0]).toMatchObject({ where: { id: 'card-1' }, data: { dueDay: 15, countAllPayments: true } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
