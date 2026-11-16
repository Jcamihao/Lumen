import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { RecurrenceFrequency, TransactionType } from '@prisma/client';
import { utcDate } from './recurrence.util';
import { RecurringTransactionsService } from './recurring-transactions.service';
import { RecurringFirstDueChangedError, RecurringWriteUncertainError } from './conversation-write.types';

const iso = (date: Date) => date.toISOString().slice(0, 10);

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  userId: 'user-1',
  type: TransactionType.EXPENSE,
  description: 'Aluguel',
  amount: 1200,
  categoryId: null,
  frequency: RecurrenceFrequency.MONTHLY,
  anchorDay: 5,
  nextDueDate: utcDate(2027, 0, 5),
  endDate: null,
  isActive: true,
  category: null,
  ...overrides,
});

const build = (existing: any = stored(), options: { category?: any; timezone?: string } = {}) => {
  const prisma: any = {
    // Transação interativa em memória: o callback recebe o mesmo cliente fake.
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    recurringTransaction: {
      findFirst: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rec-new', ...data })),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    financeCategory: {
      findFirst: jest.fn().mockResolvedValue(options.category ?? null),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ timezone: options.timezone ?? 'UTC' }),
    },
  };
  const materializer = { materializeDue: jest.fn().mockResolvedValue(0) };
  const lifeEngine = { touchUserData: jest.fn().mockResolvedValue(undefined) };
  const entitlements = { assertCanCreate: jest.fn().mockResolvedValue(undefined) };
  const service = new RecurringTransactionsService(
    prisma as any,
    materializer as any,
    lifeEngine as any,
    entitlements as any,
  );

  return { service, prisma, materializer, lifeEngine, entitlements };
};

const today = () => {
  const now = new Date();
  return utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};
const dayString = (date: Date) => iso(date);

const validCreate = (overrides: Record<string, unknown> = {}) => ({
  type: TransactionType.EXPENSE,
  description: '  Aluguel  ',
  amount: 1200,
  frequency: RecurrenceFrequency.MONTHLY,
  firstDueDate: dayString(utcDate(today().getUTCFullYear(), today().getUTCMonth() + 1, 5)),
  ...overrides,
});

describe('RecurringTransactionsService', () => {
  describe('limite do plano', () => {
    it('create checa o limite ANTES de gravar', async () => {
      const { service, prisma, entitlements } = build();
      const order: string[] = [];
      entitlements.assertCanCreate.mockImplementation(async () => {
        order.push('assert');
      });
      prisma.recurringTransaction.create.mockImplementation(async ({ data }: any) => {
        order.push('create');
        return { id: 'rec-new', ...data };
      });

      await service.create('user-1', validCreate() as any);

      expect(entitlements.assertCanCreate).toHaveBeenCalledWith('user-1', 'recurringTransactions');
      expect(order).toEqual(['assert', 'create']);
    });

    it('create com limite estourado: rejeita e nao grava', async () => {
      const { service, prisma, entitlements } = build();
      entitlements.assertCanCreate.mockRejectedValue(new Error('PLAN_LIMIT'));

      await expect(service.create('user-1', validCreate() as any)).rejects.toThrow('PLAN_LIMIT');
      expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('retomar (isActive false -> true) checa o limite antes de gravar', async () => {
      const { service, prisma, entitlements } = build(
        stored({ isActive: false, nextDueDate: utcDate(2027, 5, 5) }),
      );
      const order: string[] = [];
      entitlements.assertCanCreate.mockImplementation(async () => {
        order.push('assert');
      });
      prisma.recurringTransaction.update.mockImplementation(async () => {
        order.push('update');
        return {};
      });

      await service.update('user-1', 'rec-1', { isActive: true });

      expect(entitlements.assertCanCreate).toHaveBeenCalledWith('user-1', 'recurringTransactions');
      expect(order).toEqual(['assert', 'update']);
    });

    it('retomar com limite estourado: rejeita e nao grava', async () => {
      const { service, prisma, entitlements } = build(stored({ isActive: false }));
      entitlements.assertCanCreate.mockRejectedValue(new Error('PLAN_LIMIT'));

      await expect(service.update('user-1', 'rec-1', { isActive: true })).rejects.toThrow('PLAN_LIMIT');
      expect(prisma.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('editar conta que ja esta ativa nao checa o limite', async () => {
      const { service, entitlements } = build(stored({ isActive: true }));

      await service.update('user-1', 'rec-1', { amount: 1350 });
      await service.update('user-1', 'rec-1', { isActive: true });

      expect(entitlements.assertCanCreate).not.toHaveBeenCalled();
    });

    it('pausar nao checa o limite', async () => {
      const { service, entitlements } = build(stored({ isActive: true }));

      await service.update('user-1', 'rec-1', { isActive: false });

      expect(entitlements.assertCanCreate).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('gera o que venceu antes de listar e devolve valores numericos', async () => {
      const { service, prisma, materializer, lifeEngine } = build();
      materializer.materializeDue.mockResolvedValue(1);
      prisma.recurringTransaction.findMany.mockResolvedValue([
        stored({ amount: { valueOf: () => 99.9, toString: () => '99.9' } }),
      ]);

      const result = await service.list('user-1');

      expect(materializer.materializeDue).toHaveBeenCalledWith('user-1');
      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
      expect(result[0].amount).toBe(99.9);
    });

    it('so lista as contas do proprio usuario', async () => {
      const { service, prisma } = build();

      await service.list('user-1');

      expect(prisma.recurringTransaction.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1' });
    });
  });

  describe('create', () => {
    it('grava o dia de referencia a partir do primeiro vencimento e limpa a descricao', async () => {
      const { service, prisma, materializer } = build();
      const dto = validCreate({ firstDueDate: dayString(utcDate(today().getUTCFullYear(), today().getUTCMonth() + 1, 17)) });

      await service.create('user-1', dto as any);

      const data = prisma.recurringTransaction.create.mock.calls[0][0].data;
      expect(data.anchorDay).toBe(17);
      expect(data.description).toBe('Aluguel');
      expect(data.userId).toBe('user-1');
      // Ja tenta gerar (caso o primeiro vencimento seja hoje ou passado).
      expect(materializer.materializeDue).toHaveBeenCalled();
    });

    it('grava a forma de pagamento da conta fixa', async () => {
      const { service, prisma } = build();

      await service.create('user-1', validCreate({ paymentMethod: 'PIX' }) as any);

      expect(prisma.recurringTransaction.create.mock.calls[0][0].data.paymentMethod).toBe('PIX');
    });

    it('sem informar, grava null', async () => {
      const { service, prisma } = build();

      await service.create('user-1', validCreate() as any);

      expect(prisma.recurringTransaction.create.mock.calls[0][0].data.paymentMethod).toBeNull();
    });

    it('aceita primeiro vencimento a partir do mes passado', async () => {
      const { service } = build();
      const lastMonth = utcDate(today().getUTCFullYear(), today().getUTCMonth() - 1, 1);

      await expect(
        service.create('user-1', validCreate({ firstDueDate: dayString(lastMonth) }) as any),
      ).resolves.toBeDefined();
    });

    it('recusa primeiro vencimento anterior ao mes passado (sem historico em massa)', async () => {
      const { service, prisma } = build();
      const old = utcDate(today().getUTCFullYear(), today().getUTCMonth() - 2, 1);

      await expect(
        service.create('user-1', validCreate({ firstDueDate: dayString(old) }) as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('recusa primeiro vencimento a mais de 2 anos', async () => {
      const { service } = build();
      const far = utcDate(today().getUTCFullYear() + 3, 0, 1);

      await expect(
        service.create('user-1', validCreate({ firstDueDate: dayString(far) }) as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa data final antes do primeiro vencimento', async () => {
      const { service } = build();
      const first = utcDate(today().getUTCFullYear(), today().getUTCMonth() + 2, 10);
      const end = utcDate(today().getUTCFullYear(), today().getUTCMonth() + 2, 5);

      await expect(
        service.create('user-1', validCreate({ firstDueDate: dayString(first), endDate: dayString(end) }) as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa categoria de outro tipo (categoria de receita em despesa)', async () => {
      const { service, prisma } = build(stored(), {
        category: { id: 'cat-1', userId: 'user-1', type: TransactionType.INCOME },
      });

      await expect(
        service.create('user-1', validCreate({ categoryId: 'cat-1' }) as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('recusa categoria que nao e do usuario', async () => {
      const { service } = build(stored(), { category: null });

      await expect(
        service.create('user-1', validCreate({ categoryId: 'cat-alheia' }) as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('so mexe em conta do proprio usuario', async () => {
      const { service, prisma } = build(null);

      await expect(service.update('user-1', 'rec-alheia', { amount: 10 })).rejects.toThrow(NotFoundException);
      expect(prisma.recurringTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rec-alheia', userId: 'user-1' } }),
      );
      expect(prisma.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('altera valor e descricao sem tocar no calendario', async () => {
      const { service, prisma } = build();

      await service.update('user-1', 'rec-1', { amount: 1350, description: 'Aluguel novo' });

      const data = prisma.recurringTransaction.update.mock.calls[0][0].data;
      expect(Number(data.amount)).toBe(1350);
      expect(data.description).toBe('Aluguel novo');
      expect(data.nextDueDate).toBeUndefined();
    });

    it('troca e limpa a forma de pagamento', async () => {
      const changed = build();
      await changed.service.update('user-1', 'rec-1', { paymentMethod: 'DEBIT' });
      expect(changed.prisma.recurringTransaction.update.mock.calls[0][0].data.paymentMethod).toBe('DEBIT');

      const cleared = build();
      await cleared.service.update('user-1', 'rec-1', { paymentMethod: null });
      expect(cleared.prisma.recurringTransaction.update.mock.calls[0][0].data.paymentMethod).toBeNull();
    });

    it('pausar so liga o interruptor', async () => {
      const { service, prisma, materializer } = build();

      await service.update('user-1', 'rec-1', { isActive: false });

      const data = prisma.recurringTransaction.update.mock.calls[0][0].data;
      expect(data.isActive).toBe(false);
      expect(data.nextDueDate).toBeUndefined();
      expect(materializer.materializeDue).not.toHaveBeenCalled();
    });

    it('retomar pula os vencimentos da pausa em vez de despeja-los', async () => {
      // Pausada desde 05/2020: ao retomar, o proximo vencimento e a partir de hoje.
      const { service, prisma } = build(
        stored({ isActive: false, nextDueDate: utcDate(2020, 4, 5), anchorDay: 5 }),
      );

      await service.update('user-1', 'rec-1', { isActive: true });

      const data = prisma.recurringTransaction.update.mock.calls[0][0].data;
      expect(data.isActive).toBe(true);
      expect(data.nextDueDate.getTime()).toBeGreaterThanOrEqual(today().getTime());
      expect(data.nextDueDate.getUTCDate()).toBe(5);
    });

    it('remove a data final com null', async () => {
      const { service, prisma } = build(stored({ endDate: utcDate(2027, 5, 1) }));

      await service.update('user-1', 'rec-1', { endDate: null });

      expect(prisma.recurringTransaction.update.mock.calls[0][0].data.endDate).toBeNull();
    });

    it('recusa retomar uma conta que ja passou da data final', async () => {
      const { service } = build(
        stored({ isActive: false, nextDueDate: utcDate(2027, 5, 5), endDate: utcDate(2027, 0, 1) }),
      );

      await expect(service.update('user-1', 'rec-1', { isActive: true })).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('apaga so a conta do proprio usuario e recalcula os insights', async () => {
      const { service, prisma, lifeEngine } = build();

      await service.remove('user-1', 'rec-1');

      expect(prisma.recurringTransaction.delete).toHaveBeenCalledWith({ where: { id: 'rec-1' } });
      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
    });

    it('responde 404 para conta alheia', async () => {
      const { service, prisma } = build(null);

      await expect(service.remove('user-1', 'rec-alheia')).rejects.toThrow(NotFoundException);
      expect(prisma.recurringTransaction.delete).not.toHaveBeenCalled();
    });
  });
});

describe('RecurringTransactionsService.createForConversation (recibo do bot, mesma gravação da tela)', () => {
  // 15/11/2026 12:00 UTC: em São Paulo e em UTC é 15/11.
  const NOW = new Date('2026-11-15T12:00:00.000Z');
  const botDto = (overrides: Record<string, unknown> = {}) => ({
    type: TransactionType.EXPENSE,
    description: '  Internet  ',
    amount: 120,
    frequency: RecurrenceFrequency.MONTHLY,
    firstDueDate: '2026-11-20',
    ...overrides,
  }) as any;
  const rules = { notBefore: 'today' as const };

  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('grava uma vez na transação e devolve o recibo do que foi persistido', async () => {
    const { service, prisma, materializer, lifeEngine } = build(stored(), { timezone: 'America/Sao_Paulo' });

    const receipt = await service.createForConversation('user-1', botDto(), rules);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.recurringTransaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.recurringTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: TransactionType.EXPENSE,
        description: 'Internet',
        categoryId: null,
        paymentMethod: null,
        endDate: null,
        anchorDay: 20,
        nextDueDate: utcDate(2026, 10, 20),
      }),
    });
    expect(receipt).toEqual({
      id: 'rec-new',
      description: 'Internet',
      amountCents: 12000,
      frequency: RecurrenceFrequency.MONTHLY,
      firstDueDate: '2026-11-20',
      materializationPending: false,
      refreshPending: false,
    });
    expect(materializer.materializeDue).toHaveBeenCalledWith('user-1');
    expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
  });

  it('primeiro vencimento anterior a hoje não grava e informa o dia de hoje do núcleo', async () => {
    const { service, prisma } = build(stored(), { timezone: 'America/Sao_Paulo' });

    const error = await service
      .createForConversation('user-1', botDto({ firstDueDate: '2026-11-14' }), rules)
      .catch((e) => e);

    expect(error).toBeInstanceOf(RecurringFirstDueChangedError);
    expect(error.today).toBe('2026-11-15');
    expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
  });

  it('vencimento de hoje é aceito pelo bot (gera o lançamento na materialização)', async () => {
    const { service, prisma } = build(stored(), { timezone: 'America/Sao_Paulo' });

    const receipt = await service.createForConversation('user-1', botDto({ firstDueDate: '2026-11-15' }), rules);

    expect(receipt.firstDueDate).toBe('2026-11-15');
    expect(prisma.recurringTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('o "hoje" é o do fuso do dono: 16/11 01:00 UTC ainda é 15/11 em São Paulo e 16/11 em Tóquio', async () => {
    jest.setSystemTime(new Date('2026-11-16T01:00:00.000Z'));
    const sp = build(stored(), { timezone: 'America/Sao_Paulo' });
    await expect(
      sp.service.createForConversation('user-1', botDto({ firstDueDate: '2026-11-15' }), rules),
    ).resolves.toMatchObject({ firstDueDate: '2026-11-15' });

    const tokyo = build(stored(), { timezone: 'Asia/Tokyo' });
    const error = await tokyo.service
      .createForConversation('user-1', botDto({ firstDueDate: '2026-11-15' }), rules)
      .catch((e) => e);
    expect(error).toBeInstanceOf(RecurringFirstDueChangedError);
    expect(error.today).toBe('2026-11-16');
  });

  it('valida no domínio: descrição de 1 caractere, valor zero e frequência inválida não gravam', async () => {
    const { service, prisma } = build(stored());

    await expect(service.createForConversation('user-1', botDto({ description: ' a ' }), rules)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createForConversation('user-1', botDto({ amount: 0 }), rules)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createForConversation('user-1', botDto({ amount: 1.005 }), rules)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createForConversation('user-1', botDto({ frequency: 'DAILY' }), rules)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
  });

  it('checa o limite do plano antes de gravar; recusa sem escrita', async () => {
    const { service, prisma, entitlements } = build(stored());
    entitlements.assertCanCreate.mockRejectedValueOnce(new BadRequestException('sem vaga'));

    await expect(service.createForConversation('user-1', botDto(), rules)).rejects.toThrow('sem vaga');
    expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
  });

  it('falha na materialização depois do commit: cadastro persistido, materializationPending true, sem relançar', async () => {
    const { service, materializer, lifeEngine } = build(stored());
    materializer.materializeDue.mockRejectedValueOnce(Object.assign(new Error('falha com 120 reais'), { name: 'PrismaClientKnownRequestError' }));

    const receipt = await service.createForConversation('user-1', botDto(), rules);

    expect(receipt).toMatchObject({ id: 'rec-new', materializationPending: true, refreshPending: false });
    expect(lifeEngine.touchUserData).toHaveBeenCalledTimes(1);
  });

  it('falha na atualização dos dados derivados: refreshPending true, cadastro mantido', async () => {
    const { service, lifeEngine } = build(stored());
    lifeEngine.touchUserData.mockRejectedValueOnce(new Error('falha'));

    const receipt = await service.createForConversation('user-1', botDto(), rules);

    expect(receipt).toMatchObject({ id: 'rec-new', materializationPending: false, refreshPending: true });
  });

  it('o log do erro leva só o nome do erro: nem descrição nem valor', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, materializer } = build(stored());
    materializer.materializeDue.mockRejectedValueOnce(new Error('Internet 120 vazou aqui'));

    await service.createForConversation('user-1', botDto(), rules);

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('Internet');
    expect(logged).not.toContain('120');
    expect(logged).not.toContain('vazou');
    expect(logged).toContain('"errorName":"Error"');
    warn.mockRestore();
  });

  it('commit de resultado desconhecido (callback concluiu, commit falhou) vira RecurringWriteUncertainError', async () => {
    const { service, prisma } = build(stored());
    prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      await fn(prisma);
      throw new Error('conexao perdida no commit');
    });

    await expect(service.createForConversation('user-1', botDto(), rules)).rejects.toBeInstanceOf(RecurringWriteUncertainError);
  });

  it('erro dentro do callback antes do fim é rollback conhecido, não resultado desconhecido', async () => {
    const { service, prisma } = build(stored());
    prisma.recurringTransaction.create.mockRejectedValueOnce(new Error('antes do fim'));

    const error = await service.createForConversation('user-1', botDto(), rules).catch((e) => e);

    expect(error.message).toBe('antes do fim');
    expect(error).not.toBeInstanceOf(RecurringWriteUncertainError);
  });

  it('o recibo não depende de leitura posterior (findFirst depois da gravação falhando não afeta o bot)', async () => {
    const { service, prisma } = build(stored());
    prisma.recurringTransaction.findFirst.mockRejectedValue(new Error('leitura'));

    const receipt = await service.createForConversation('user-1', botDto(), rules);

    expect(receipt).toMatchObject({ id: 'rec-new', amountCents: 12000 });
    expect(prisma.recurringTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('a tela mantém o formato: materialização falhando não vira erro depois do cadastro', async () => {
    const { service, materializer } = build(stored());
    materializer.materializeDue.mockRejectedValueOnce(new Error('falha'));

    const item = await service.create('user-1', validCreate());

    // Resposta lida depois da gravação (findOwned): o formato da tela não muda.
    expect(item).toMatchObject({ id: 'rec-1', amount: 1200, isActive: true });
  });
});
