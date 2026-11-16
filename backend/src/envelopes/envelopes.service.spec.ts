import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EnvelopesService } from './envelopes.service';
import { EnvelopeMonthChangedError, EnvelopeWriteUncertainError } from './conversation-write.types';
import { utcDate } from '../recurring-transactions/recurrence.util';

const decimal = (value: number) => ({ toString: () => String(value), valueOf: () => value });

describe('EnvelopesService', () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: 'env-1',
    userId: 'user-1',
    name: 'Gasolina',
    color: '#f18f01',
    icon: 'local_gas_station',
    monthlyAmount: decimal(700),
    isActive: true,
    createdAt: utcDate(2026, 6, 10), // criado em 10/07/2026
    ...overrides,
  });

  const build = (options: {
    envelope?: any;
    topUps?: Array<{ month: Date; amount: any }>;
    spent?: number | null;
  } = {}) => {
    // 'envelope' in options distingue "nao passei" (usa o padrao) de "passei null"
    // (simula envelope de outro usuario / inexistente) — null ?? stored() cairia
    // no padrao por engano, ja que null e undefined sao ambos nulos por ??.
    const envelopeOrDefault = 'envelope' in options ? options.envelope : stored();
    const topUpState = [...(options.topUps ?? [])];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma: any = {
      envelope: {
        findMany: jest.fn().mockResolvedValue([envelopeOrDefault]),
        findFirst: jest.fn().mockResolvedValue(envelopeOrDefault),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(stored(data))),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ ...(options.envelope ?? stored()), ...data }),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      envelopeTopUp: {
        findFirst: jest.fn().mockImplementation(() => {
          const latest = [...topUpState].sort((a, b) => b.month.getTime() - a.month.getTime())[0];
          return Promise.resolve(latest ?? null);
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          if (topUpState.some((row) => row.month.getTime() === data.month.getTime())) {
            return Promise.reject(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
          }
          topUpState.push({ month: data.month, amount: data.amount });
          return Promise.resolve(data);
        }),
        aggregate: jest.fn().mockImplementation(({ where }: any) => {
          const sum = topUpState
            .filter((row) => row.month.getTime() <= where.month.lte.getTime())
            .reduce((total, row) => total + Number(row.amount), 0);
          return Promise.resolve({ _sum: { amount: sum || null } });
        }),
      },
      transaction: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: options.spent ?? null } }),
      },
    };
    // Transação interativa em memória: o callback recebe o mesmo cliente fake.
    Object.assign(prisma, {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    });
    const lifeEngine = { touchUserData: jest.fn().mockResolvedValue(undefined) };
    const entitlements = { assertCanCreate: jest.fn().mockResolvedValue(undefined) };
    const service = new EnvelopesService(prisma as any, lifeEngine as any, entitlements as any);

    return { service, prisma, lifeEngine, topUpState, entitlements };
  };

  describe('create', () => {
    it('cria o envelope e ja gera o deposito do mes', async () => {
      const { service, prisma } = build({ topUps: [] });

      const now = utcDate(2026, 8, 21);
      const result = await service.create('user-1', {
        name: 'Gasolina',
        color: '#f18f01',
        monthlyAmount: 700,
      } as any);

      expect(prisma.envelope.create.mock.calls[0][0].data).toMatchObject({
        userId: 'user-1',
        name: 'Gasolina',
      });
      expect(result.deposited).toBeGreaterThan(0);
    });

    it('recalcula os insights ao criar', async () => {
      const { service, lifeEngine } = build();

      await service.create('user-1', { name: 'Gasolina', color: '#f18f01', monthlyAmount: 700 } as any);

      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
    });
  });

  describe('limite do plano', () => {
    it('create checa o limite ANTES de gravar', async () => {
      const { service, prisma, entitlements } = build();
      const order: string[] = [];
      entitlements.assertCanCreate.mockImplementation(async () => {
        order.push('assert');
      });
      prisma.envelope.create.mockImplementation(async ({ data }: any) => {
        order.push('create');
        return stored(data);
      });

      await service.create('user-1', { name: 'Gasolina', color: '#f18f01', monthlyAmount: 700 } as any);

      expect(entitlements.assertCanCreate).toHaveBeenCalledWith('user-1', 'envelopes');
      expect(order).toEqual(['assert', 'create']);
    });

    it('create com limite estourado: rejeita e nao grava', async () => {
      const { service, prisma, entitlements } = build();
      entitlements.assertCanCreate.mockRejectedValue(new Error('PLAN_LIMIT'));

      await expect(
        service.create('user-1', { name: 'Gasolina', color: '#f18f01', monthlyAmount: 700 } as any),
      ).rejects.toThrow('PLAN_LIMIT');
      expect(prisma.envelope.create).not.toHaveBeenCalled();
    });

    it('reativar (isActive false -> true) checa o limite antes de gravar', async () => {
      const envelope = stored({ isActive: false });
      const { service, prisma, entitlements } = build({ envelope });
      const order: string[] = [];
      entitlements.assertCanCreate.mockImplementation(async () => {
        order.push('assert');
      });
      prisma.envelope.update.mockImplementation(async ({ data }: any) => {
        order.push('update');
        return { ...envelope, ...data };
      });

      await service.update('user-1', 'env-1', { isActive: true } as any);

      expect(entitlements.assertCanCreate).toHaveBeenCalledWith('user-1', 'envelopes');
      expect(order).toEqual(['assert', 'update']);
    });

    it('reativar com limite estourado: rejeita e nao grava', async () => {
      const { service, prisma, entitlements } = build({ envelope: stored({ isActive: false }) });
      entitlements.assertCanCreate.mockRejectedValue(new Error('PLAN_LIMIT'));

      await expect(service.update('user-1', 'env-1', { isActive: true } as any)).rejects.toThrow('PLAN_LIMIT');
      expect(prisma.envelope.update).not.toHaveBeenCalled();
    });

    it('editar reserva que ja esta ativa nao checa o limite', async () => {
      const { service, entitlements } = build({ envelope: stored({ isActive: true }) });

      await service.update('user-1', 'env-1', { name: 'Combustivel' } as any);
      await service.update('user-1', 'env-1', { isActive: true } as any);

      expect(entitlements.assertCanCreate).not.toHaveBeenCalled();
    });

    it('pausar nao checa o limite', async () => {
      const { service, entitlements } = build({ envelope: stored({ isActive: true }) });

      await service.update('user-1', 'env-1', { isActive: false } as any);

      expect(entitlements.assertCanCreate).not.toHaveBeenCalled();
    });
  });

  describe('list — geracao de depositos (catch-up)', () => {
    it('envelope recem-criado, mesmo mes: gera so 1 deposito', async () => {
      const envelope = stored({ createdAt: utcDate(2026, 8, 5) });
      const { service, topUpState } = build({ envelope, topUps: [] });

      const [result] = await service.list('user-1', utcDate(2026, 8, 21));

      expect(topUpState).toHaveLength(1);
      expect(result.deposited).toBe(700);
    });

    it('3 meses sem abrir o app: gera os 3 depositos que faltam', async () => {
      const envelope = stored({ createdAt: utcDate(2026, 6, 10) }); // criado em julho
      const { service, topUpState } = build({ envelope, topUps: [] });

      const [result] = await service.list('user-1', utcDate(2026, 8, 15)); // hoje = setembro

      expect(topUpState).toHaveLength(3); // jul, ago, set
      expect(result.deposited).toBe(3 * 700);
    });

    it('nao duplica deposito do mes que ja existe (idempotente)', async () => {
      const envelope = stored({ createdAt: utcDate(2026, 8, 1) });
      const { service, topUpState } = build({
        envelope,
        topUps: [{ month: utcDate(2026, 8, 1), amount: decimal(700) }],
      });

      await service.list('user-1', utcDate(2026, 8, 28));

      expect(topUpState).toHaveLength(1);
    });

    it('envelope pausado nao gera deposito novo, mas mantem o saldo acumulado', async () => {
      const envelope = stored({ isActive: false, createdAt: utcDate(2026, 5, 1) });
      const { service, topUpState } = build({
        envelope,
        topUps: [{ month: utcDate(2026, 5, 1), amount: decimal(700) }],
      });

      const [result] = await service.list('user-1', utcDate(2026, 8, 15));

      expect(topUpState).toHaveLength(1);
      expect(result.deposited).toBe(700);
    });
  });

  describe('saldo disponivel', () => {
    it('disponivel = depositado - gasto (rollover automatico: nao volta ao valor cheio todo mes)', async () => {
      const envelope = stored({ createdAt: utcDate(2026, 6, 1) });
      const { service } = build({
        envelope,
        topUps: [
          { month: utcDate(2026, 6, 1), amount: decimal(700) },
          { month: utcDate(2026, 7, 1), amount: decimal(700) },
        ],
        spent: 500,
      });

      const [result] = await service.list('user-1', utcDate(2026, 7, 20));

      expect(result.deposited).toBe(1400);
      expect(result.spent).toBe(500);
      expect(result.available).toBe(900);
    });

    it('gasto maior que o disponivel gera saldo negativo (nao trava)', async () => {
      const { service } = build({ topUps: [{ month: utcDate(2026, 8, 1), amount: decimal(700) }], spent: 900 });

      const [result] = await service.list('user-1', utcDate(2026, 8, 15));

      expect(result.available).toBe(-200);
    });
  });

  describe('update', () => {
    it('so mexe em envelope do proprio usuario', async () => {
      const { service, prisma } = build({ envelope: null });

      await expect(service.update('user-1', 'env-alheio', { monthlyAmount: 100 } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.envelope.update).not.toHaveBeenCalled();
    });

    it('mudar o valor mensal so afeta depositos futuros (os ja gerados ficam)', async () => {
      const envelope = stored({ createdAt: utcDate(2026, 7, 1) });
      const { service, prisma, topUpState } = build({
        envelope,
        topUps: [{ month: utcDate(2026, 7, 1), amount: decimal(700) }],
      });
      prisma.envelope.findFirst.mockResolvedValue(envelope);

      await service.update('user-1', 'env-1', { monthlyAmount: 900 } as any);

      // O deposito de agosto (novo) usa 900; o de julho (ja existia) continua 700.
      const august = topUpState.find((row) => row.month.getTime() === utcDate(2026, 8, 1).getTime());
      expect(Number(august?.amount)).toBe(900);
    });

    it('pausar (isActive=false) nao gera deposito do mes', async () => {
      const envelope = stored({ createdAt: utcDate(2026, 8, 1) });
      const { service, prisma, topUpState } = build({ envelope, topUps: [{ month: utcDate(2026, 8, 1), amount: decimal(700) }] });
      prisma.envelope.findFirst.mockResolvedValue(envelope);

      await service.update('user-1', 'env-1', { isActive: false } as any);

      expect(topUpState).toHaveLength(1);
    });
  });

  describe('remove', () => {
    it('so remove envelope do proprio usuario', async () => {
      const { service, prisma } = build({ envelope: null });

      await expect(service.remove('user-1', 'env-alheio')).rejects.toThrow(NotFoundException);
      expect(prisma.envelope.delete).not.toHaveBeenCalled();
    });

    it('remove e recalcula os insights', async () => {
      const { service, prisma, lifeEngine } = build();

      await service.remove('user-1', 'env-1');

      expect(prisma.envelope.delete).toHaveBeenCalledWith({ where: { id: 'env-1' } });
      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
    });
  });

  describe('concorrencia', () => {
    it('duas chamadas simultaneas nao duplicam o deposito do mes (indice unico do banco)', async () => {
      const envelope = stored({ createdAt: utcDate(2026, 8, 1) });
      const { service, topUpState } = build({ envelope, topUps: [] });

      await Promise.all([service.list('user-1', utcDate(2026, 8, 15)), service.list('user-1', utcDate(2026, 8, 15))]);

      expect(topUpState).toHaveLength(1);
    });
  });

  describe('nome duplicado', () => {
    const p2002 = () => Object.assign(new Error('Unique constraint'), { code: 'P2002' });

    it('criar com nome ja usado devolve erro legivel (nao o 500 cru do Prisma)', async () => {
      const { service, prisma } = build();
      prisma.envelope.create.mockRejectedValue(p2002());

      await expect(
        service.create('user-1', { name: 'Gasolina', color: '#000', monthlyAmount: 700 } as any),
      ).rejects.toThrow('Você já tem um envelope com este nome.');
    });

    it('renomear para um nome ja usado tambem devolve erro legivel', async () => {
      const { service, prisma } = build();
      prisma.envelope.update.mockRejectedValue(p2002());

      await expect(service.update('user-1', 'env-1', { name: 'Mercado' } as any)).rejects.toThrow(
        'Você já tem um envelope com este nome.',
      );
    });

    it('outros erros do banco continuam subindo sem virar mensagem de nome duplicado', async () => {
      const { service, prisma } = build();
      prisma.envelope.create.mockRejectedValue(new Error('conexao caiu'));

      await expect(
        service.create('user-1', { name: 'Gasolina', color: '#000', monthlyAmount: 700 } as any),
      ).rejects.toThrow('conexao caiu');
    });
  });

  describe('createForConversation (recibo do bot, mesma gravação da tela)', () => {
    const dto = { name: 'Gasolina', color: '#f18f01', monthlyAmount: 400 };
    // 15/11/2026 UTC: provisão do mês 2026-11-01.
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-15T12:00:00.000Z') }));
    afterEach(() => jest.useRealTimers());

    it('cria envelope e provisão do mês UTC na mesma transação e devolve o recibo', async () => {
      const { service, prisma } = build();

      const receipt = await service.createForConversation('user-1', dto, '2026-11-01');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.envelopeTopUp.create).toHaveBeenCalledWith({
        data: { envelopeId: 'env-1', month: utcDate(2026, 10, 1), amount: expect.anything() },
      });
      expect(receipt).toEqual({
        id: 'env-1',
        name: 'Gasolina',
        monthlyCents: 40000,
        provisionMonth: '2026-11-01',
        refreshPending: false,
      });
    });

    it('mês mudou desde a exibição: recusa sem criar nada e informa o mês atual', async () => {
      const { service, prisma } = build();

      const error = await service.createForConversation('user-1', dto, '2026-10-01').catch((e) => e);

      expect(error).toBeInstanceOf(EnvelopeMonthChangedError);
      expect(error.provisionMonth).toBe('2026-11-01');
      expect(prisma.envelope.create).not.toHaveBeenCalled();
    });

    it('falha na provisão inicial sobe como erro comprovado (não vira resultado desconhecido)', async () => {
      const { service, prisma } = build();
      prisma.envelopeTopUp.create.mockRejectedValueOnce(new Error('falha na provisao'));

      const error = await service.createForConversation('user-1', dto, '2026-11-01').catch((e) => e);

      expect(error.message).toBe('falha na provisao');
      expect(error).not.toBeInstanceOf(EnvelopeWriteUncertainError);
    });

    it('falha de confirmação do commit depois do callback vira resultado desconhecido', async () => {
      const { service, prisma } = build();
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        await fn(prisma);
        throw new Error('conexao perdida no commit');
      });

      await expect(service.createForConversation('user-1', dto, '2026-11-01')).rejects.toBeInstanceOf(
        EnvelopeWriteUncertainError,
      );
    });

    it('erro dentro do callback antes do fim é comprovado como não gravado', async () => {
      const { service, prisma } = build();
      prisma.envelope.create.mockRejectedValueOnce(new Error('antes do fim'));

      const error = await service.createForConversation('user-1', dto, '2026-11-01').catch((e) => e);

      expect(error).not.toBeInstanceOf(EnvelopeWriteUncertainError);
      expect(prisma.envelopeTopUp.create).not.toHaveBeenCalled();
    });

    it('envelope e provisão usam o cliente da transação, nunca o cliente global', async () => {
      const { service, prisma } = build();
      const tx = {
        envelope: {
          create: jest.fn(async ({ data }: any) => ({ id: 'env-tx', name: data.name, monthlyAmount: data.monthlyAmount })),
        },
        envelopeTopUp: { create: jest.fn(async () => ({})) },
      };
      prisma.$transaction.mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) => fn(tx));

      const receipt = await service.createForConversation('user-1', dto, '2026-11-01');

      expect(receipt.id).toBe('env-tx');
      expect(tx.envelope.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-1', name: 'Gasolina', color: '#f18f01' }),
      });
      expect(tx.envelopeTopUp.create).toHaveBeenCalledWith({
        data: { envelopeId: 'env-tx', month: utcDate(2026, 10, 1), amount: expect.anything() },
      });
      expect(prisma.envelope.create).not.toHaveBeenCalled();
      expect(prisma.envelopeTopUp.create).not.toHaveBeenCalled();
    });

    it('falha na provisão inicial descarta o envelope junto: nada é confirmado fora da transação', async () => {
      const { service, prisma } = build();
      const committed: string[] = [];
      prisma.$transaction.mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) => {
        const staged: string[] = [];
        const tx = {
          envelope: {
            create: jest.fn(async ({ data }: any) => {
              staged.push('envelope');
              return { id: 'env-tx', name: data.name, monthlyAmount: data.monthlyAmount };
            }),
          },
          envelopeTopUp: { create: jest.fn(async () => { throw new Error('falha na provisao'); }) },
        };
        const result = await fn(tx); // rejeita: o commit abaixo nunca roda (rollback)
        committed.push(...staged);
        return result;
      });

      await expect(service.createForConversation('user-1', dto, '2026-11-01')).rejects.toThrow('falha na provisao');

      expect(committed).toEqual([]);
      expect(prisma.envelope.create).not.toHaveBeenCalled();
    });

    it('o recibo não depende de agregação posterior: leituras de saldo falhando não afetam a reserva', async () => {
      const { service, prisma } = build();
      prisma.envelopeTopUp.aggregate.mockRejectedValue(new Error('agregacao'));
      prisma.transaction.aggregate.mockRejectedValue(new Error('agregacao'));

      const receipt = await service.createForConversation('user-1', dto, '2026-11-01');

      expect(receipt).toMatchObject({ id: 'env-1', monthlyCents: 40000, refreshPending: false });
      expect(prisma.envelopeTopUp.aggregate).not.toHaveBeenCalled();
      expect(prisma.transaction.aggregate).not.toHaveBeenCalled();
    });

    it('nome já usado pelo mesmo dono: mensagem conhecida, não o erro cru', async () => {
      const { service, prisma } = build();
      prisma.envelope.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(service.createForConversation('user-1', dto, '2026-11-01')).rejects.toThrow(
        'Você já tem um envelope com este nome.',
      );
      expect(prisma.envelopeTopUp.create).not.toHaveBeenCalled();
    });

    it('limite do plano é checado antes de abrir a transação', async () => {
      const { service, prisma, entitlements } = build();
      entitlements.assertCanCreate.mockRejectedValueOnce(new BadRequestException('limite'));

      await expect(service.createForConversation('user-1', dto, '2026-11-01')).rejects.toThrow('limite');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('valida no domínio: nome de 1 ou 61 caracteres, valor zero e decimais demais são recusados', async () => {
      const { service, prisma } = build();

      await expect(service.createForConversation('user-1', { ...dto, name: 'a' }, '2026-11-01')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.createForConversation('user-1', { ...dto, name: 'x'.repeat(61) }, '2026-11-01'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createForConversation('user-1', { ...dto, monthlyAmount: 0 }, '2026-11-01')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.createForConversation('user-1', { ...dto, monthlyAmount: 1.005 }, '2026-11-01'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('nome é aparado e tem 2 ou 60 caracteres aceitos', async () => {
      // Um build por caso: o fake de provisão guarda o mês e não aceita o segundo do mesmo envelope.
      const trimmed = await build().service.createForConversation('user-1', { ...dto, name: '  Gas  ' }, '2026-11-01');
      const longest = await build().service.createForConversation('user-1', { ...dto, name: 'x'.repeat(60) }, '2026-11-01');

      expect(trimmed.name).toBe('Gas');
      expect(longest.name).toHaveLength(60);
    });

    it('falha ao atualizar dados derivados não desfaz a reserva: refreshPending true', async () => {
      const { service, lifeEngine } = build();
      lifeEngine.touchUserData.mockRejectedValueOnce(new Error('insights'));

      const receipt = await service.createForConversation('user-1', dto, '2026-11-01');

      expect(receipt.id).toBe('env-1');
      expect(receipt.refreshPending).toBe(true);
    });
  });

  describe('create (tela) mantém o formato da resposta', () => {
    it('devolve os campos de sempre', async () => {
      const { service } = build();

      const response = await service.create('user-1', { name: 'Gasolina', color: '#f18f01', monthlyAmount: 400 });

      expect(Object.keys(response).sort()).toEqual(
        ['available', 'color', 'deposited', 'icon', 'id', 'isActive', 'monthlyAmount', 'name', 'spent'].sort(),
      );
    });
  });
});
