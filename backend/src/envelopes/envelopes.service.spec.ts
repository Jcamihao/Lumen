import { NotFoundException } from '@nestjs/common';
import { EnvelopesService } from './envelopes.service';
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
    const prisma = {
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
});
