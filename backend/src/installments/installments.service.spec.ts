import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { utcDate } from '../recurring-transactions/recurrence.util';
import { InstallmentsService } from './installments.service';
import { InstallmentFirstDueChangedError, InstallmentWriteUncertainError } from './conversation-write.types';

const iso = (date: Date) => date.toISOString().slice(0, 10);
const decimal = (value: number) => new Prisma.Decimal(value);

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'plan-1',
  userId: 'user-1',
  description: 'iPhone',
  totalAmount: decimal(1000),
  installmentAmount: decimal(100),
  installmentsTotal: 10,
  installmentsGenerated: 3,
  categoryId: null,
  paymentMethod: null,
  anchorDay: 5,
  nextDueDate: utcDate(2027, 0, 5),
  isActive: true,
  category: null,
  ...overrides,
});

const build = (existing: any = stored(), options: { category?: any; timezone?: string } = {}) => {
  const prisma: any = {
    // Transação interativa em memória: o callback recebe o mesmo cliente fake.
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    installmentPurchase: {
      findFirst: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'plan-new', ...data })),
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
  const service = new InstallmentsService(
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
  description: '  iPhone  ',
  totalAmount: 1000,
  installmentsTotal: 10,
  firstDueDate: dayString(utcDate(today().getUTCFullYear(), today().getUTCMonth() + 1, 5)),
  ...overrides,
});

describe('InstallmentsService', () => {
  describe('limite do plano', () => {
    it('create checa o limite ANTES de gravar', async () => {
      const { service, prisma, entitlements } = build();
      const order: string[] = [];
      entitlements.assertCanCreate.mockImplementation(async () => {
        order.push('assert');
      });
      prisma.installmentPurchase.create.mockImplementation(async ({ data }: any) => {
        order.push('create');
        return { id: 'plan-new', ...data };
      });

      await service.create('user-1', validCreate() as any);

      expect(entitlements.assertCanCreate).toHaveBeenCalledWith('user-1', 'installmentPurchases');
      expect(order).toEqual(['assert', 'create']);
    });

    it('create com limite estourado: rejeita e nao grava', async () => {
      const { service, prisma, entitlements } = build();
      entitlements.assertCanCreate.mockRejectedValue(new Error('PLAN_LIMIT'));

      await expect(service.create('user-1', validCreate() as any)).rejects.toThrow('PLAN_LIMIT');
      expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('gera o que venceu antes de listar e devolve valores numericos com o progresso', async () => {
      const { service, prisma, materializer, lifeEngine } = build();
      materializer.materializeDue.mockResolvedValue(1);
      prisma.installmentPurchase.findMany.mockResolvedValue([stored()]);

      const result = await service.list('user-1');

      expect(materializer.materializeDue).toHaveBeenCalledWith('user-1');
      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
      expect(result[0].totalAmount).toBe(1000);
      expect(result[0].installmentAmount).toBe(100);
      expect(result[0].paidAmount).toBe(300);
      expect(result[0].remainingAmount).toBe(700);
      expect(result[0].remainingInstallments).toBe(7);
    });

    it('quando ja gerou todas, o valor pago e o total (sem depender da soma das parcelas)', async () => {
      const { service, prisma } = build();
      prisma.installmentPurchase.findMany.mockResolvedValue([
        stored({ installmentsGenerated: 10, installmentsTotal: 10, isActive: false, nextDueDate: null }),
      ]);

      const result = await service.list('user-1');

      expect(result[0].paidAmount).toBe(1000);
      expect(result[0].remainingAmount).toBe(0);
      expect(result[0].remainingInstallments).toBe(0);
    });

    it('so lista as compras do proprio usuario', async () => {
      const { service, prisma } = build();

      await service.list('user-1');

      expect(prisma.installmentPurchase.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1' });
    });
  });

  describe('create', () => {
    it('grava o dia de referencia a partir do primeiro vencimento e limpa a descricao', async () => {
      const { service, prisma, materializer } = build();
      const dto = validCreate({
        firstDueDate: dayString(utcDate(today().getUTCFullYear(), today().getUTCMonth() + 1, 17)),
      });

      await service.create('user-1', dto as any);

      const data = prisma.installmentPurchase.create.mock.calls[0][0].data;
      expect(data.anchorDay).toBe(17);
      expect(data.description).toBe('iPhone');
      expect(data.userId).toBe('user-1');
      expect(data.installmentsTotal).toBe(10);
      // Ja tenta gerar a 1a parcela (caso o vencimento seja hoje ou passado).
      expect(materializer.materializeDue).toHaveBeenCalled();
    });

    it('divide o valor total pelo numero de parcelas, arredondado em 2 casas', async () => {
      const { service, prisma } = build();

      await service.create('user-1', validCreate({ totalAmount: 100, installmentsTotal: 3 }) as any);

      const data = prisma.installmentPurchase.create.mock.calls[0][0].data;
      expect(Number(data.installmentAmount)).toBe(33.33);
      expect(Number(data.totalAmount)).toBe(100);
    });

    it('sem informar o vencimento, usa hoje', async () => {
      const { service, prisma } = build();

      await service.create('user-1', validCreate({ firstDueDate: undefined }) as any);

      const data = prisma.installmentPurchase.create.mock.calls[0][0].data;
      expect(iso(data.nextDueDate)).toBe(iso(today()));
    });

    it('grava a forma de pagamento', async () => {
      const { service, prisma } = build();

      await service.create('user-1', validCreate({ paymentMethod: 'CREDIT' }) as any);

      expect(prisma.installmentPurchase.create.mock.calls[0][0].data.paymentMethod).toBe('CREDIT');
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
      expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
    });

    it('recusa primeiro vencimento a mais de 2 anos', async () => {
      const { service } = build();
      const far = utcDate(today().getUTCFullYear() + 3, 0, 1);

      await expect(
        service.create('user-1', validCreate({ firstDueDate: dayString(far) }) as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa categoria de outro tipo (categoria de receita em compra parcelada)', async () => {
      const { service, prisma } = build(stored(), {
        category: { id: 'cat-1', userId: 'user-1', type: TransactionType.INCOME },
      });

      await expect(
        service.create('user-1', validCreate({ categoryId: 'cat-1' }) as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
    });

    it('recusa categoria que nao e do usuario', async () => {
      const { service } = build(stored(), { category: null });

      await expect(
        service.create('user-1', validCreate({ categoryId: 'cat-alheia' }) as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('apaga so a compra do proprio usuario e recalcula os insights', async () => {
      const { service, prisma, lifeEngine } = build();

      await service.remove('user-1', 'plan-1');

      expect(prisma.installmentPurchase.delete).toHaveBeenCalledWith({ where: { id: 'plan-1' } });
      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
    });

    it('responde 404 para compra alheia', async () => {
      const { service, prisma } = build(null);

      await expect(service.remove('user-1', 'plan-alheia')).rejects.toThrow(NotFoundException);
      expect(prisma.installmentPurchase.delete).not.toHaveBeenCalled();
    });
  });
});

describe('InstallmentsService.createForConversation (recibo do bot, mesma gravação da tela)', () => {
  // 15/11/2026 12:00 UTC: em São Paulo e em UTC é 15/11.
  const NOW = new Date('2026-11-15T12:00:00.000Z');
  const botDto = (overrides: Record<string, unknown> = {}) => ({
    description: '  Geladeira  ',
    totalAmount: 1200,
    installmentsTotal: 12,
    firstDueDate: '2026-11-20',
    ...overrides,
  }) as any;
  const rules = { notBefore: 'today' as const };

  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('grava uma vez na transação, sem categoria nem pagamento, e devolve o recibo', async () => {
    const { service, prisma } = build(stored(), { timezone: 'America/Sao_Paulo' });

    const receipt = await service.createForConversation('user-1', botDto(), rules);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.installmentPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        description: 'Geladeira',
        categoryId: null,
        paymentMethod: null,
        anchorDay: 20,
        nextDueDate: utcDate(2026, 10, 20),
        installmentsTotal: 12,
      }),
    });
    expect(receipt).toEqual({
      id: 'plan-new',
      description: 'Geladeira',
      totalCents: 120000,
      installmentsTotal: 12,
      installmentCents: 10000,
      lastInstallmentCents: 10000,
      firstDueDate: '2026-11-20',
      materializationPending: false,
      refreshPending: false,
    });
  });

  it('divisão: parcela comum arredondada e última absorvendo a sobra (100 em 3 = 33,33 + 33,34)', async () => {
    const { service } = build(stored());

    const receipt = await service.createForConversation('user-1', botDto({ totalAmount: 100, installmentsTotal: 3 }), rules);

    expect(receipt).toMatchObject({ installmentCents: 3333, lastInstallmentCents: 3334 });
    expect(receipt.lastInstallmentCents + receipt.installmentCents * 2).toBe(10000);
  });

  it('regressão: R$ 1,00 em 60 vezes é recusado (parcela comum 0,02 e última negativa), sem gravar', async () => {
    const { service, prisma } = build(stored());

    await expect(
      service.createForConversation('user-1', botDto({ totalAmount: 1, installmentsTotal: 60 }), rules),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
  });

  it('a última parcela zerada também é recusada (R$ 0,01 em 2 vezes)', async () => {
    const { service, prisma } = build(stored());

    await expect(
      service.createForConversation('user-1', botDto({ totalAmount: 0.01, installmentsTotal: 2 }), rules),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
  });

  it('a tela recusa a mesma divisão (regra no serviço, não só no bot)', async () => {
    const { service, prisma } = build(stored());

    await expect(service.create('user-1', botDto({ totalAmount: 1, installmentsTotal: 60 }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
  });

  it('quantidade fora de 2 a 60 e fracionária não gravam', async () => {
    const { service, prisma } = build(stored());

    for (const installmentsTotal of [1, 61, 2.5]) {
      await expect(
        service.createForConversation('user-1', botDto({ installmentsTotal }), rules),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
  });

  it('primeiro vencimento anterior a hoje não grava e informa o dia de hoje do núcleo', async () => {
    const { service, prisma } = build(stored(), { timezone: 'America/Sao_Paulo' });

    const error = await service
      .createForConversation('user-1', botDto({ firstDueDate: '2026-11-14' }), rules)
      .catch((e) => e);

    expect(error).toBeInstanceOf(InstallmentFirstDueChangedError);
    expect(error.today).toBe('2026-11-15');
    expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
  });

  it('o "hoje" do rascunho vem do fuso do dono (Tóquio já em 16/11)', async () => {
    jest.setSystemTime(new Date('2026-11-16T01:00:00.000Z'));
    const { service } = build(stored(), { timezone: 'Asia/Tokyo' });

    const error = await service
      .createForConversation('user-1', botDto({ firstDueDate: '2026-11-15' }), rules)
      .catch((e) => e);

    expect(error).toBeInstanceOf(InstallmentFirstDueChangedError);
    expect(error.today).toBe('2026-11-16');
  });

  it('vencimento de hoje é aceito pelo bot', async () => {
    const { service, prisma } = build(stored(), { timezone: 'America/Sao_Paulo' });

    const receipt = await service.createForConversation('user-1', botDto({ firstDueDate: '2026-11-15' }), rules);

    expect(receipt.firstDueDate).toBe('2026-11-15');
    expect(prisma.installmentPurchase.create).toHaveBeenCalledTimes(1);
  });

  it('checa o limite do plano antes de gravar', async () => {
    const { service, prisma, entitlements } = build(stored());
    entitlements.assertCanCreate.mockRejectedValueOnce(new BadRequestException('sem vaga'));

    await expect(service.createForConversation('user-1', botDto(), rules)).rejects.toThrow('sem vaga');
    expect(prisma.installmentPurchase.create).not.toHaveBeenCalled();
  });

  it('falha na materialização depois do commit: materializationPending true, sem relançar', async () => {
    const { service, materializer } = build(stored());
    materializer.materializeDue.mockRejectedValueOnce(new Error('falha'));

    const receipt = await service.createForConversation('user-1', botDto(), rules);

    expect(receipt).toMatchObject({ id: 'plan-new', materializationPending: true, refreshPending: false });
  });

  it('falha na atualização dos dados derivados: refreshPending true, cadastro mantido', async () => {
    const { service, lifeEngine } = build(stored());
    lifeEngine.touchUserData.mockRejectedValueOnce(new Error('falha'));

    const receipt = await service.createForConversation('user-1', botDto(), rules);

    expect(receipt).toMatchObject({ id: 'plan-new', materializationPending: false, refreshPending: true });
  });

  it('commit de resultado desconhecido vira InstallmentWriteUncertainError', async () => {
    const { service, prisma } = build(stored());
    prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      await fn(prisma);
      throw new Error('conexao perdida no commit');
    });

    await expect(service.createForConversation('user-1', botDto(), rules)).rejects.toBeInstanceOf(InstallmentWriteUncertainError);
  });

  it('erro dentro do callback antes do fim é rollback conhecido', async () => {
    const { service, prisma } = build(stored());
    prisma.installmentPurchase.create.mockRejectedValueOnce(new Error('antes do fim'));

    const error = await service.createForConversation('user-1', botDto(), rules).catch((e) => e);

    expect(error).not.toBeInstanceOf(InstallmentWriteUncertainError);
  });

  it('a tela mantém o formato: materialização falhando não vira erro depois do cadastro', async () => {
    const { service, materializer } = build(stored());
    materializer.materializeDue.mockRejectedValueOnce(new Error('falha'));

    const item = await service.create('user-1', validCreate());

    expect(item).toMatchObject({ id: 'plan-1', installmentsTotal: 10 });
  });
});
