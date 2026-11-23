import { ConflictException, NotFoundException, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import { CreditCycleService } from '../credit-cycle/credit-cycle.service';
import { CreditCardsService, CreditCardWriteUncertainError, MAX_ACTIVE_CARDS_PER_USER } from './credit-cards.service';

type Row = Record<string, any>;

const norm = (x: unknown) => (x instanceof Date ? x.getTime() : (x ?? null));
const eq = (a: unknown, b: unknown) => norm(a) === norm(b);

/** Filtro minimo no formato do Prisma: igualdade, not, equals (insensitive), lt, OR. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'OR') return (cond as Row[]).some((sub) => matches(row, sub));
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Row;
      if ('not' in c) return !eq(value, c.not);
      if ('equals' in c) {
        // O Prisma traduz equals+insensitive para ILIKE: "%" e "_" do valor viram curinga (como no Postgres real).
        if (c.mode === 'insensitive') {
          const pattern = String(c.equals).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
          return new RegExp('^' + pattern + '$', 'is').test(String(value ?? ''));
        }
        return eq(value, c.equals);
      }
      if ('lt' in c) return norm(value) < norm(c.lt);
      return true;
    }
    return eq(value, cond);
  });
}

const pick = (row: Row, select?: Row) => {
  if (!select) return { ...row };
  const out: Row = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
};

const apply = (row: Row, data: Row) => {
  for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v;
};

function sortRows(rows: Row[], orderBy?: Row | Row[]) {
  const list = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
  return [...rows].sort((a, b) => {
    for (const o of list) {
      const [k, dir] = Object.entries(o)[0];
      const av = norm(a[k]) as any;
      const bv = norm(b[k]) as any;
      if (av === bv) continue;
      const r = av < bv ? -1 : 1;
      return dir === 'desc' ? -r : r;
    }
    return 0;
  });
}

/**
 * Banco em memoria: cartoes, tetos e usuarios com dono. Transacao tira um
 * "lock" por usuario (FOR NO KEY UPDATE) que so sai no fim; falhas injetadas
 * antes ou depois do commit.
 */
function createFakeDb() {
  const state = {
    users: new Map<string, Row>(),
    cards: [] as Row[],
    ceilings: [] as Row[],
    seq: 0,
  };
  const log: string[] = [];
  const faults: { failBeforeCommit?: boolean; failAfterCommit?: boolean; creditCardUpdateOnce?: Error } = {};
  const locks = new Map<string, Promise<void>>();

  async function acquire(key: string): Promise<() => void> {
    for (;;) {
      const current = locks.get(key);
      if (!current) break;
      await current;
    }
    let release!: () => void;
    const p = new Promise<void>((r) => (release = r));
    locks.set(key, p);
    return () => {
      if (locks.get(key) === p) locks.delete(key);
      release();
    };
  }

  const snapshotState = () => ({
    users: new Map([...state.users].map(([k, v]) => [k, { ...v }])),
    cards: state.cards.map((c) => ({ ...c })),
    ceilings: state.ceilings.map((c) => ({ ...c })),
    seq: state.seq,
  });
  const restore = (snap: ReturnType<typeof snapshotState>) => {
    state.users = snap.users;
    state.cards = snap.cards;
    state.ceilings = snap.ceilings;
    state.seq = snap.seq;
  };

  const flatKey = (where: Row) =>
    where.cardId_closingDate ? { cardId: where.cardId_closingDate.cardId, closingDate: where.cardId_closingDate.closingDate } : where;

  /** ctx.snap: estado guardado quando a transacao pega o lock (rollback so desfaz o proprio trabalho). */
  const models = (held: Array<() => void>, ctx: { snap?: ReturnType<typeof snapshotState> }) => ({
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const userId = String(values[0]);
      held.push(await acquire(userId));
      if (!ctx.snap) ctx.snap = snapshotState();
      log.push(`lock:${userId}`);
      return [];
    },
    user: {
      findUniqueOrThrow: async ({ where, select }: Row) => {
        const u = state.users.get(where.id);
        if (!u) throw new Error('usuario nao encontrado');
        return pick(u, select);
      },
      update: async ({ where, data }: Row) => {
        const u = state.users.get(where.id);
        if (!u) throw new Error('usuario nao encontrado');
        log.push('user.update');
        apply(u, data);
        return { ...u };
      },
    },
    creditCard: {
      count: async ({ where }: Row) => {
        if (faults.failBeforeCommit) {
          faults.failBeforeCommit = false;
          throw new Error('falha antes do commit');
        }
        return state.cards.filter((c) => matches(c, where)).length;
      },
      findFirst: async ({ where, select }: Row) => {
        const c = state.cards.find((row) => matches(row, where));
        return c ? pick(c, select) : null;
      },
      findMany: async ({ where, orderBy, select }: Row) =>
        sortRows(state.cards.filter((c) => matches(c, where)), orderBy).map((c) => pick(c, select)),
      create: async ({ data, select }: Row) => {
        const now = new Date(Date.UTC(2026, 0, 1) + ++state.seq * 1000);
        const row: Row = {
          id: `card-new-${state.seq}`,
          dueDay: null,
          countAllPayments: false,
          isDefault: false,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        state.cards.push(row);
        log.push('card.create');
        return pick(row, select);
      },
      update: async ({ where, data, select }: Row) => {
        if (faults.creditCardUpdateOnce) {
          const err = faults.creditCardUpdateOnce;
          faults.creditCardUpdateOnce = undefined;
          throw err;
        }
        const c = state.cards.find((row) => row.id === where.id);
        if (!c) throw new Error('cartao nao encontrado');
        log.push(`card.update:${where.id}`);
        apply(c, data);
        c.updatedAt = new Date();
        return pick(c, select);
      },
      updateMany: async ({ where, data }: Row) => {
        const hit = state.cards.filter((c) => matches(c, where));
        log.push('card.updateMany');
        hit.forEach((c) => apply(c, data));
        return { count: hit.length };
      },
    },
    creditCycleCeiling: {
      findUnique: async ({ where }: Row) => {
        const k = flatKey(where);
        return state.ceilings.find((c) => eq(c.cardId, k.cardId) && eq(c.closingDate, k.closingDate)) ?? null;
      },
      findFirst: async ({ where, orderBy }: Row) =>
        sortRows(state.ceilings.filter((c) => matches(c, where)), orderBy)[0] ?? null,
      upsert: async ({ where, create, update }: Row) => {
        const k = flatKey(where);
        const existing = state.ceilings.find((c) => eq(c.cardId, k.cardId) && eq(c.closingDate, k.closingDate));
        log.push('ceiling.upsert');
        if (existing) {
          apply(existing, update);
          return { ...existing };
        }
        const row = { id: `ceil-${++state.seq}`, ...create };
        state.ceilings.push(row);
        return { ...row };
      },
    },
    transaction: {
      aggregate: async () => ({ _sum: { amount: null } }),
    },
  });

  const root = models([], {});
  const prisma: Row = {
    ...root,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const held: Array<() => void> = [];
      const ctx: { snap?: ReturnType<typeof snapshotState> } = {};
      let committed = false;
      try {
        const result = await fn(models(held, ctx));
        if (faults.failAfterCommit) {
          // Commit ocorreu e a resposta se perdeu: o estado fica gravado.
          faults.failAfterCommit = false;
          committed = true;
          throw new Error('conexao perdida no commit');
        }
        return result;
      } catch (error) {
        if (!committed && ctx.snap) restore(ctx.snap);
        throw error;
      } finally {
        held.forEach((release) => release());
      }
    },
  };

  const addUser = (id: string, monthClosingDay = 5) => {
    state.users.set(id, {
      id,
      timezone: 'America/Sao_Paulo',
      monthClosingDay,
      creditDueDay: null,
      creditCycleCountAllPayments: false,
    });
  };
  const addCard = (card: Row) => {
    state.cards.push({
      dueDay: null,
      countAllPayments: false,
      isDefault: false,
      archivedAt: null,
      createdAt: new Date(Date.UTC(2026, 0, 1) + state.cards.length * 1000),
      updatedAt: new Date(Date.UTC(2026, 0, 1)),
      ...card,
    });
  };

  return { prisma, state, log, faults, addUser, addCard, snapshot: () => JSON.stringify({ users: [...state.users.values()], cards: state.cards, ceilings: state.ceilings }) };
}

describe('CreditCardsService', () => {
  let db: ReturnType<typeof createFakeDb>;
  let lifeEngine: { touchUserData: jest.Mock };
  let service: CreditCardsService;

  /** Usuarios A, B e C. A tem padrao (Principal, dia 5) e Nubank (dia 20, nao padrao). */
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-15T12:00:00.000Z') });
    db = createFakeDb();
    db.addUser('user-a', 5);
    db.addUser('user-b', 10);
    db.addUser('user-c', 15);
    db.addCard({ id: 'card-a1', userId: 'user-a', name: 'Principal', closingDay: 5, isDefault: true });
    db.addCard({ id: 'card-a2', userId: 'user-a', name: 'Nubank', closingDay: 20, dueDay: 27 });
    db.addCard({ id: 'card-b1', userId: 'user-b', name: 'Principal', closingDay: 10, isDefault: true });
    db.addCard({ id: 'card-c1', userId: 'user-c', name: 'Principal', closingDay: 15, isDefault: true });
    lifeEngine = { touchUserData: jest.fn().mockResolvedValue(undefined) };
    const creditCycle = new CreditCycleService(db.prisma as any, lifeEngine as any);
    service = new CreditCardsService(db.prisma as any, lifeEngine as any, creditCycle);
  });
  afterEach(() => jest.useRealTimers());

  const cardsOf = (userId: string) => db.state.cards.filter((c) => c.userId === userId);
  const activeDefaults = (userId: string) => cardsOf(userId).filter((c) => c.isDefault && !c.archivedAt);
  const user = (id: string) => db.state.users.get(id)!;

  describe('criar', () => {
    it('cria cartao nao padrao com nome aparado e devolve recibo', async () => {
      const receipt = await service.create('user-a', { name: '  Inter  ', closingDay: 10, dueDay: 17 });

      expect(receipt).toEqual({
        id: expect.any(String),
        name: 'Inter',
        closingDay: 10,
        dueDay: 17,
        countAllPayments: false,
        isDefault: false,
        refreshPending: false,
      });
      expect(activeDefaults('user-a').map((c) => c.id)).toEqual(['card-a1']);
    });

    it('nome repetido sem diferenciar maiuscula: 409 e nada gravado', async () => {
      const before = db.snapshot();

      await expect(service.create('user-a', { name: 'nubank', closingDay: 3 })).rejects.toBeInstanceOf(ConflictException);
      expect(db.snapshot()).toBe(before);
    });

    it('"_" e "%" no nome nao viram curinga: nao colidem com outro nome, mas o mesmo nome continua 409', async () => {
      await expect(service.create('user-a', { name: 'N_bank', closingDay: 3 })).resolves.toMatchObject({ name: 'N_bank' });
      await expect(service.create('user-a', { name: '%', closingDay: 3 })).resolves.toMatchObject({ name: '%' });
      await expect(service.create('user-a', { name: 'Cartao 100%', closingDay: 3 })).resolves.toMatchObject({ name: 'Cartao 100%' });
      await expect(service.create('user-a', { name: 'n_BANK', closingDay: 3 })).rejects.toBeInstanceOf(ConflictException);
      await expect(service.create('user-a', { name: 'NxBank', closingDay: 3 })).resolves.toMatchObject({ name: 'NxBank' });
    });

    it('renomear para nome com "_" nao colide com outro nome parecido', async () => {
      await expect(service.update('user-a', 'card-a2', { name: 'Pri_cipal' })).resolves.toMatchObject({ name: 'Pri_cipal' });
    });

    it('mesmo nome em outro usuario nao conflita', async () => {
      await expect(service.create('user-b', { name: 'Nubank', closingDay: 3 })).resolves.toMatchObject({ name: 'Nubank' });
    });

    it(`teto tecnico de ${MAX_ACTIVE_CARDS_PER_USER} ativos: o 11o e recusado; arquivado nao conta`, async () => {
      for (let i = 0; i < MAX_ACTIVE_CARDS_PER_USER - 2; i++) {
        await service.create('user-a', { name: `Extra ${i}`, closingDay: 1 + (i % 28) });
      }
      expect(cardsOf('user-a').filter((c) => !c.archivedAt)).toHaveLength(MAX_ACTIVE_CARDS_PER_USER);

      await expect(service.create('user-a', { name: 'Onze', closingDay: 2 })).rejects.toBeInstanceOf(UnprocessableEntityException);

      await service.archive('user-a', 'card-a2');
      await expect(service.create('user-a', { name: 'Onze', closingDay: 2 })).resolves.toMatchObject({ name: 'Onze' });
    });

    it('countAllPayments=true em cartao novo: 400 sem gravar', async () => {
      const before = db.snapshot();

      await expect(
        service.create('user-a', { name: 'Novo', closingDay: 3, countAllPayments: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.snapshot()).toBe(before);
    });

    it('nome so com espacos: 400', async () => {
      await expect(service.create('user-a', { name: '   ', closingDay: 3 })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('ler e listar', () => {
    it('lista: padrao primeiro; arquivados so com includeArchived', async () => {
      await service.archive('user-a', 'card-a2');

      expect((await service.list('user-a', false)).map((c) => c.id)).toEqual(['card-a1']);
      expect((await service.list('user-a', true)).map((c) => c.id)).toEqual(['card-a1', 'card-a2']);
    });

    it('lista nunca traz cartao de outro usuario', async () => {
      expect((await service.list('user-c', true)).map((c) => c.id)).toEqual(['card-c1']);
    });
  });

  describe('isolamento A/B/C em todas as rotas', () => {
    const routes: Array<[string, (u: string, id: string) => Promise<unknown>]> = [
      ['GET :id', (u, id) => service.get(u, id)],
      ['PATCH :id', (u, id) => service.update(u, id, { name: 'Invadido' })],
      ['DELETE :id', (u, id) => service.archive(u, id)],
      ['make-default', (u, id) => service.makeDefault(u, id)],
      ['GET :id/cycle', (u, id) => service.cycle(u, id)],
      ['PUT :id/ceiling', (u, id) => service.setCeiling(u, id, { ceiling: 100 })],
    ];

    for (const [name, call] of routes) {
      it(`${name}: cartao de A para B e C responde 404 e nada muda`, async () => {
        const before = db.snapshot();

        for (const intruder of ['user-b', 'user-c']) {
          for (const cardId of ['card-a1', 'card-a2']) {
            await expect(call(intruder, cardId)).rejects.toBeInstanceOf(NotFoundException);
          }
        }
        expect(db.snapshot()).toBe(before);
      });
    }

    it('cartao inexistente tambem responde 404 (mesma resposta do alheio)', async () => {
      await expect(service.get('user-a', 'card-nao-existe')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('editar', () => {
    it('PATCH do padrao espelha dia, vencimento e countAllPayments no User, depois do lock', async () => {
      const receipt = await service.update('user-a', 'card-a1', { closingDay: 12, dueDay: null, countAllPayments: true });

      expect(receipt).toMatchObject({ id: 'card-a1', closingDay: 12, dueDay: null, countAllPayments: true, isDefault: true, refreshPending: false });
      expect(user('user-a')).toMatchObject({ monthClosingDay: 12, creditDueDay: null, creditCycleCountAllPayments: true });
      expect(db.log.indexOf('lock:user-a')).toBeLessThan(db.log.indexOf('card.update:card-a1'));
      expect(db.log.indexOf('card.update:card-a1')).toBeLessThan(db.log.indexOf('user.update'));
    });

    it('PATCH de cartao nao padrao nao mexe no User', async () => {
      await service.update('user-a', 'card-a2', { closingDay: 25, dueDay: 3 });

      expect(db.log).not.toContain('user.update');
      expect(user('user-a').monthClosingDay).toBe(5);
    });

    it('countAllPayments=true em cartao nao padrao: 400 sem gravar', async () => {
      const before = db.snapshot();

      await expect(service.update('user-a', 'card-a2', { countAllPayments: true })).rejects.toBeInstanceOf(BadRequestException);
      expect(db.snapshot()).toBe(before);
    });

    it('renomear para nome de outro cartao ativo (outra caixa): 409', async () => {
      await expect(service.update('user-a', 'card-a1', { name: 'NUBANK' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('manter o proprio nome trocando so a caixa: ok', async () => {
      await expect(service.update('user-a', 'card-a2', { name: 'nubank' })).resolves.toMatchObject({ name: 'nubank' });
    });

    it('cartao arquivado nao pode ser editado: 409', async () => {
      await service.archive('user-a', 'card-a2');

      await expect(service.update('user-a', 'card-a2', { closingDay: 1 })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('arquivar e padrao', () => {
    it('arquivar o padrao e recusado: cartao segue ativo e User intacto', async () => {
      const before = db.snapshot();

      await expect(service.archive('user-a', 'card-a1')).rejects.toBeInstanceOf(ConflictException);
      expect(db.snapshot()).toBe(before);
    });

    it('arquivar nao apaga: teto continua ligado ao cartao e o recibo traz archivedAt', async () => {
      db.state.ceilings.push({ id: 'ceil-old', cardId: 'card-a2', userId: 'user-a', closingDate: new Date('2026-11-20T00:00:00.000Z'), ceiling: 900 });

      const receipt = await service.archive('user-a', 'card-a2');

      expect(receipt).toMatchObject({ id: 'card-a2', isDefault: false, refreshPending: false });
      expect(receipt.archivedAt).toEqual(expect.any(String));
      expect(cardsOf('user-a').find((c) => c.id === 'card-a2')).toBeDefined();
      expect(db.state.ceilings.find((c) => c.id === 'ceil-old')!.cardId).toBe('card-a2');
    });

    it('nome de cartao arquivado volta a ficar livre', async () => {
      await service.archive('user-a', 'card-a2');

      await expect(service.create('user-a', { name: 'NuBank', closingDay: 9 })).resolves.toMatchObject({ name: 'NuBank' });
    });

    it('cartao arquivado nao vira padrao nem recebe teto: 409', async () => {
      await service.archive('user-a', 'card-a2');

      await expect(service.makeDefault('user-a', 'card-a2')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.setCeiling('user-a', 'card-a2', { ceiling: 100 })).rejects.toBeInstanceOf(ConflictException);
    });

    it('make-default troca o padrao: um so ativo, User espelha o novo, antigo perde countAllPayments', async () => {
      db.state.cards[0].countAllPayments = true;
      user('user-a').creditCycleCountAllPayments = true;

      const receipt = await service.makeDefault('user-a', 'card-a2');

      expect(receipt).toMatchObject({ id: 'card-a2', isDefault: true, closingDay: 20, dueDay: 27, refreshPending: false });
      expect(activeDefaults('user-a').map((c) => c.id)).toEqual(['card-a2']);
      expect(cardsOf('user-a').find((c) => c.id === 'card-a1')).toMatchObject({ isDefault: false, countAllPayments: false });
      expect(user('user-a')).toMatchObject({ monthClosingDay: 20, creditDueDay: 27, creditCycleCountAllPayments: false });
    });

    it('make-default no padrao atual: recibo sem escrita', async () => {
      const before = db.snapshot();

      const receipt = await service.makeDefault('user-a', 'card-a1');

      expect(receipt).toMatchObject({ id: 'card-a1', isDefault: true, refreshPending: false });
      expect(db.snapshot()).toBe(before);
    });
  });

  describe('teto do cartao', () => {
    it('PUT ceiling grava por cardId e devolve recibo com o cartao', async () => {
      const receipt = await service.setCeiling('user-a', 'card-a2', { ceiling: 800 });

      expect(receipt).toEqual({
        cardId: 'card-a2',
        id: expect.any(String),
        ceilingCents: 80000,
        cycleStart: '2026-10-21',
        cycleEnd: '2026-11-20',
        refreshPending: false,
      });
      expect(db.state.ceilings.find((c) => c.cardId === 'card-a2')).toMatchObject({ userId: 'user-a' });
    });

    it('cycle devolve o ciclo do proprio cartao', async () => {
      const cycle = await service.cycle('user-a', 'card-a2');

      expect(cycle).toMatchObject({ closingDay: 20, dueDay: 27, cycleEnd: '2026-11-20T00:00:00.000Z' });
    });
  });

  describe('recibo e falhas', () => {
    it('falha auxiliar depois do commit: persiste, refreshPending true, sem repetir', async () => {
      lifeEngine.touchUserData.mockRejectedValueOnce(new Error('fila indisponivel'));

      const receipt = await service.create('user-a', { name: 'Inter', closingDay: 4 });

      expect(receipt).toMatchObject({ name: 'Inter', refreshPending: true });
      expect(cardsOf('user-a').some((c) => c.name === 'Inter')).toBe(true);
      expect(lifeEngine.touchUserData).toHaveBeenCalledTimes(1);
    });

    it('falha no commit depois do callback: resultado desconhecido, sem repetir', async () => {
      db.faults.failAfterCommit = true;

      await expect(service.create('user-a', { name: 'Inter', closingDay: 4 })).rejects.toBeInstanceOf(CreditCardWriteUncertainError);
      expect(db.log.filter((entry) => entry === 'card.create')).toHaveLength(1);
      // Simulacao: o commit aconteceu e so a resposta se perdeu.
      expect(cardsOf('user-a').some((c) => c.name === 'Inter')).toBe(true);
    });

    it('falha antes do commit: erro comprovado, nada gravado', async () => {
      const before = db.snapshot();
      db.faults.failBeforeCommit = true;

      const error = await service.create('user-a', { name: 'Inter', closingDay: 4 }).catch((e) => e);

      expect(error.message).toBe('falha antes do commit');
      expect(error).not.toBeInstanceOf(CreditCardWriteUncertainError);
      expect(db.snapshot()).toBe(before);
    });

    it('falha no meio do make-default: volta tudo, padrao antigo e User continuam certos', async () => {
      const before = db.snapshot();
      db.faults.creditCardUpdateOnce = new Error('falha no update');

      await expect(service.makeDefault('user-a', 'card-a2')).rejects.toThrow('falha no update');
      expect(db.snapshot()).toBe(before);
    });
  });

  describe('concorrencia', () => {
    it('duas criacoes simultaneas com o mesmo nome: uma grava, a outra 409', async () => {
      const results = await Promise.allSettled([
        service.create('user-a', { name: 'Itau', closingDay: 5 }),
        service.create('user-a', { name: 'itau', closingDay: 6 }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      expect(cardsOf('user-a').filter((c) => c.name.toLowerCase() === 'itau')).toHaveLength(1);
    });

    it('promover padrao e editar o padrao em paralelo: um so padrao e o User espelha o padrao final', async () => {
      await Promise.allSettled([
        service.makeDefault('user-a', 'card-a2'),
        service.update('user-a', 'card-a1', { closingDay: 25 }),
      ]);

      const defaults = activeDefaults('user-a');
      expect(defaults).toHaveLength(1);
      expect(user('user-a').monthClosingDay).toBe(defaults[0].closingDay);
    });
  });
});
