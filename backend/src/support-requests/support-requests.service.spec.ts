import { SupportRequestType } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';
import { SupportRequestsService } from './support-requests.service';

const build = () => {
  const prisma = {
    supportRequest: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'sr-1', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _avg: { rating: null } }),
      groupBy: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  return { prisma, service: new SupportRequestsService(prisma as any) };
};

const baseDto = {
  type: SupportRequestType.FEEDBACK,
  subject: 'Feedback · Finanças · nota 4/5',
  message: 'O que funcionou bem:\nGostei da rosca de gastos.',
};

describe('SupportRequestsService', () => {
  describe('create', () => {
    it('grava nota, area e autorizacao de contato do feedback', async () => {
      const { service, prisma } = build();

      await service.create('user-1', 'ana@example.com', {
        ...baseDto,
        rating: 4,
        area: 'FINANCES',
        canContact: true,
      } as any);

      expect(prisma.supportRequest.create.mock.calls[0][0].data).toMatchObject({
        userId: 'user-1',
        emailSnapshot: 'ana@example.com',
        rating: 4,
        area: 'FINANCES',
        canContact: true,
      });
    });

    it('sem autorizacao explicita, canContact fica falso (nunca nulo)', async () => {
      const { service, prisma } = build();

      await service.create('user-1', 'ana@example.com', baseDto as any);

      expect(prisma.supportRequest.create.mock.calls[0][0].data.canContact).toBe(false);
    });

    it('bug report continua sem nota nem area', async () => {
      const { service, prisma } = build();

      await service.create('user-1', 'ana@example.com', {
        type: SupportRequestType.BUG_REPORT,
        subject: 'Erro ao salvar',
        message: 'Nao consegui salvar a transacao.',
      } as any);

      const data = prisma.supportRequest.create.mock.calls[0][0].data;
      expect(data.rating).toBeUndefined();
      expect(data.area).toBeUndefined();
    });
  });

  describe('listAll', () => {
    it('filtra por status e por tipo, e devolve os campos de feedback', async () => {
      const { service, prisma } = build();

      await service.listAll({ status: 'OPEN' as any, type: SupportRequestType.FEEDBACK, page: 1 });

      const query = prisma.supportRequest.findMany.mock.calls[0][0];
      expect(query.where).toEqual({ status: 'OPEN', type: 'FEEDBACK' });
      expect(query.select).toMatchObject({ rating: true, area: true, canContact: true });
    });
  });

  describe('feedbackSummary', () => {
    it('so considera feedback com nota', async () => {
      const { service, prisma } = build();

      await service.feedbackSummary();

      expect(prisma.supportRequest.aggregate.mock.calls[0][0].where).toEqual({
        type: 'FEEDBACK',
        rating: { not: null },
      });
    });

    it('calcula media (1 casa), distribuicao completa e areas por volume', async () => {
      const { service, prisma } = build();
      prisma.supportRequest.aggregate.mockResolvedValue({
        _count: { _all: 4 },
        _avg: { rating: 3.75 },
      });
      prisma.supportRequest.groupBy
        .mockResolvedValueOnce([
          { rating: 5, _count: { _all: 2 } },
          { rating: 4, _count: { _all: 1 } },
          { rating: 1, _count: { _all: 1 } },
        ])
        .mockResolvedValueOnce([
          { area: 'HOME', _count: { _all: 1 }, _avg: { rating: 5 } },
          { area: 'FINANCES', _count: { _all: 3 }, _avg: { rating: 3.3333 } },
        ]);

      const summary = await service.feedbackSummary();

      expect(summary.total).toBe(4);
      expect(summary.averageRating).toBe(3.8);
      expect(summary.distribution).toEqual({ 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 });
      expect(summary.byArea.map((row) => row.area)).toEqual(['FINANCES', 'HOME']);
      expect(summary.byArea[0].averageRating).toBe(3.3);
    });

    it('sem feedback devolve media nula e distribuicao zerada', async () => {
      const { service } = build();

      const summary = await service.feedbackSummary();

      expect(summary).toEqual({
        total: 0,
        averageRating: null,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        byArea: [],
      });
    });
  });
});

describe('CreateSupportRequestDto — validacao do feedback', () => {
  const check = async (overrides: Record<string, unknown>) =>
    validate(plainToInstance(CreateSupportRequestDto, { ...baseDto, ...overrides }));

  it('aceita nota de 1 a 5 e uma area conhecida', async () => {
    expect(await check({ rating: 1, area: 'HOME', canContact: false })).toHaveLength(0);
    expect(await check({ rating: 5, area: 'GENERAL', canContact: true })).toHaveLength(0);
  });

  it('recusa nota fora de 1-5 ou nao inteira', async () => {
    expect(await check({ rating: 0 })).not.toHaveLength(0);
    expect(await check({ rating: 6 })).not.toHaveLength(0);
    expect(await check({ rating: 3.5 })).not.toHaveLength(0);
  });

  it('recusa area que nao existe (texto livre nao entra no banco)', async () => {
    expect(await check({ area: 'HACK<script>' })).not.toHaveLength(0);
  });

  it('nota e area continuam opcionais (bug report e suporte antigo)', async () => {
    expect(await check({})).toHaveLength(0);
  });
});
