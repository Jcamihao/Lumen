import { Prisma } from '@prisma/client';
import { CreditCycleService } from './credit-cycle.service';

const decimal = (value: number) => new Prisma.Decimal(value);

describe('CreditCycleService', () => {
  const build = (options: {
    monthClosingDay?: number;
    creditDueDay?: number | null;
    ceilingRow?: { ceiling: any } | null;
    previousCeilingRow?: { ceiling: any } | null;
    spentSum?: number | null;
    timezone?: string;
  } = {}) => {
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          timezone: options.timezone ?? 'America/Sao_Paulo',
          monthClosingDay: options.monthClosingDay ?? 5,
          creditDueDay: options.creditDueDay ?? null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      creditCycleCeiling: {
        findUnique: jest.fn().mockResolvedValue(options.ceilingRow ?? null),
        findFirst: jest.fn().mockResolvedValue(options.previousCeilingRow ?? null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      transaction: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: options.spentSum ?? null } }),
      },
    };
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

    it('so busca transacoes EXPENSE + CREDIT dentro do ciclo', async () => {
      const { service, prisma } = build();

      await service.getCurrent('user-1');

      expect(prisma.transaction.aggregate.mock.calls[0][0].where).toMatchObject({
        userId: 'user-1',
        type: 'EXPENSE',
        paymentMethod: 'CREDIT',
      });
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

    it('devolve o dia de vencimento junto (so informativo)', async () => {
      const { service } = build({ creditDueDay: 15 });

      expect((await service.getCurrent('user-1')).dueDay).toBe(15);
    });
  });

  describe('updateSettings', () => {
    it('grava o dia de vencimento', async () => {
      const { service, prisma } = build();

      await service.updateSettings('user-1', { dueDay: 12 });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { creditDueDay: 12 },
      });
    });

    it('null limpa o dia de vencimento', async () => {
      const { service, prisma } = build();

      await service.updateSettings('user-1', { dueDay: null });

      expect(prisma.user.update.mock.calls[0][0].data.creditDueDay).toBeNull();
    });

    it('recalcula os insights apos mudar as configuracoes', async () => {
      const { service, lifeEngine } = build();

      await service.updateSettings('user-1', { dueDay: 10 });

      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
    });
  });

  describe('setCeiling', () => {
    it('grava o teto do ciclo aberto agora (upsert por closingDate)', async () => {
      const { service, prisma } = build();

      await service.setCeiling('user-1', { ceiling: 1600 });

      const call = prisma.creditCycleCeiling.upsert.mock.calls[0][0];
      expect(call.where.userId_closingDate.userId).toBe('user-1');
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
});
