import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { GroupService } from './group.service';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, any>;

/** Igualdade + null + {gt} (o suficiente dos where que o GroupService emite). */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (typeof cond === 'object' && cond instanceof Date) return value?.getTime() === cond.getTime();
    if (typeof cond === 'object' && cond !== null) {
      if ('gt' in cond) return new Date(value).getTime() > new Date(cond.gt).getTime();
      return false;
    }
    return value === cond;
  });
}

let idSeq = 0;
const nextId = (prefix: string) => `${prefix}-${++idSeq}`;

function makeDb() {
  const state = {
    users: [] as Array<{ id: string; email: string; name: string | null }>,
    memberships: [] as Row[],
    invites: [] as Row[],
    subs: [] as Row[],
    transactions: [] as Row[],
    categories: [] as Row[],
  };

  const withInclude = (row: Row, include?: Row): Row => {
    if (!include) return row;
    const out = { ...row };
    if (include.owner) {
      out.owner = state.users.find((u) => u.id === row.ownerUserId) ?? null;
    }
    if (include.member) {
      out.member = state.users.find((u) => u.id === row.memberUserId) ?? null;
    }
    return out;
  };

  const db: any = {
    state,
    groupMembership: {
      findFirst: async ({ where, include }: any) => {
        const row = state.memberships.find((m) => matches(m, where));
        return row ? withInclude(row, include) : null;
      },
      findMany: async ({ where, include }: any) => {
        return state.memberships
          .filter((m) => matches(m, where))
          .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
          .map((m) => withInclude(m, include));
      },
      count: async ({ where }: any) => state.memberships.filter((m) => matches(m, where)).length,
      update: async ({ where, data }: any) => {
        const row = state.memberships.find((m) => m.id === where.id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const targets = state.memberships.filter((m) => matches(m, where));
        targets.forEach((m) => Object.assign(m, data));
        return { count: targets.length };
      },
      create: async ({ data }: any) => {
        // Espelha o indice unico parcial da SQL (membro com UMA membership ativa).
        if (
          state.memberships.some((m) => m.memberUserId === data.memberUserId && m.leftAt === null)
        ) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
          });
        }
        const row = {
          id: nextId('member'),
          ownerUserId: data.ownerUserId,
          memberUserId: data.memberUserId,
          joinedAt: new Date(),
          leftAt: null,
          createdAt: new Date(),
        };
        state.memberships.push(row);
        return row;
      },
    },
    groupInvite: {
      count: async ({ where }: any) => state.invites.filter((i) => matches(i, where)).length,
      findMany: async ({ where }: any) =>
        state.invites
          .filter((i) => matches(i, where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      findUnique: async ({ where }: any) =>
        state.invites.find((i) => i.tokenHash === where.tokenHash) ?? null,
      updateMany: async ({ where, data }: any) => {
        const targets = state.invites.filter((i) => matches(i, where));
        targets.forEach((i) => Object.assign(i, data));
        return { count: targets.length };
      },
      create: async ({ data }: any) => {
        const row = {
          id: nextId('invite'),
          ownerUserId: data.ownerUserId,
          email: data.email,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          revokedAt: null,
          acceptedAt: null,
          acceptedUserId: null,
          createdAt: new Date(),
        };
        state.invites.push(row);
        return row;
      },
    },
    subscription: {
      findMany: async ({ where }: any) => state.subs.filter((s) => matches(s, where)),
    },
    transaction: {
      updateMany: async ({ where, data }: any) => {
        const targets = state.transactions.filter((t) => matches(t, where));
        targets.forEach((t) => Object.assign(t, data));
        return { count: targets.length };
      },
    },
    financeCategory: {
      updateMany: async ({ where, data }: any) => {
        const targets = state.categories.filter((c) => matches(c, where));
        targets.forEach((c) => Object.assign(c, data));
        return { count: targets.length };
      },
    },
    user: {
      findUnique: async ({ where, select }: any) => {
        const user = state.users.find((u) => u.id === where.id) ?? null;
        if (!user || !select) return user;
        return Object.fromEntries(Object.keys(select).map((k) => [k, (user as Row)[k]]));
      },
    },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
  };
  return db;
}

function sharedSub(ownerUserId: string, overrides: Row = {}): Row {
  return {
    ownerUserId,
    plan: 'SHARED',
    status: 'ACTIVE',
    source: 'ASAAS',
    currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY),
    ...overrides,
  };
}

function build() {
  const db = makeDb();
  // A paga o grupo; B entrou pelo convite; C e estranha; D convidada sem grupo; Z outro pagador.
  db.state.users.push(
    { id: 'user-a', email: 'ana@exemplo.com', name: 'Ana Beatriz Souza' },
    { id: 'user-b', email: 'bruno@exemplo.com', name: 'Bruno' },
    { id: 'user-c', email: 'carla@exemplo.com', name: 'Carla' },
    { id: 'user-d', email: 'dani@exemplo.com', name: 'Dani Lima' },
    { id: 'user-z', email: 'zoe@exemplo.com', name: 'Zoe' },
  );
  db.state.subs.push(sharedSub('user-a'));
  const service = new GroupService(db as any);
  return { db, service };
}

const INVALID = 'Este convite de grupo é inválido ou expirou.';

async function errorOf(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('esperava erro');
}

describe('GroupService (contrato 11, 11a)', () => {
  beforeEach(() => {
    idSeq = 0;
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  const activeMember = (db: any, ownerUserId: string, memberUserId: string) => ({
    id: nextId('member'),
    ownerUserId,
    memberUserId,
    joinedAt: new Date(NOW.getTime() - 3 * DAY),
    leftAt: null,
    createdAt: new Date(NOW.getTime() - 3 * DAY),
  });

  const pendingInvite = (db: any, ownerUserId: string, email: string, token = 't-' + nextId('x') + '-token-com-tamanho-suficiente-123456') => {
    const row = {
      id: nextId('invite'),
      ownerUserId,
      email,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(NOW.getTime() + 6 * DAY),
      revokedAt: null,
      acceptedAt: null,
      acceptedUserId: null,
      createdAt: new Date(NOW.getTime() - DAY),
    };
    db.state.invites.push(row);
    return { row, token };
  };

  describe('getGroup', () => {
    it('pagador ve membros e so convites pendentes, com seats do catalogo', async () => {
      const { db, service } = build();
      db.state.memberships.push(activeMember(db, 'user-a', 'user-b'));
      pendingInvite(db, 'user-a', 'dani@exemplo.com');
      db.state.invites.push({
        id: 'invite-expirado',
        ownerUserId: 'user-a',
        email: 'velho@exemplo.com',
        tokenHash: 'h-velho',
        expiresAt: new Date(NOW.getTime() - DAY),
        revokedAt: null,
        acceptedAt: null,
        acceptedUserId: null,
        createdAt: new Date(NOW.getTime() - 9 * DAY),
      });

      const view = await service.getGroup('user-a');
      expect(view).toEqual({
        role: 'owner',
        planActive: true,
        seats: 2,
        members: [
          { id: expect.any(String), email: 'bruno@exemplo.com', name: 'Bruno', joinedAt: activeMember(db, 'user-a', 'user-b').joinedAt.toISOString() },
        ],
        invites: [{ id: expect.any(String), email: 'dani@exemplo.com', createdAt: expect.any(String), expiresAt: expect.any(String) }],
      });
    });

    it('membro ve somente o primeiro nome do pagador e a data de entrada (D10)', async () => {
      const { db, service } = build();
      db.state.memberships.push(activeMember(db, 'user-a', 'user-b'));

      const view = await service.getGroup('user-b');
      expect(view).toEqual({
        role: 'member',
        ownerFirstName: 'Ana',
        joinedAt: expect.any(String),
      });
      const json = JSON.stringify(view);
      expect(json).not.toContain('ana@exemplo.com');
      expect(json).not.toContain('Beatriz Souza');
    });

    it('quem nao e de grupo nenhum ouve 404', async () => {
      const { service } = build();
      await expect(service.getGroup('user-c')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('pagador com SHARED vencido e membros ativos: owner com planActive false', async () => {
      const { db, service } = build();
      db.state.subs = [sharedSub('user-a', { status: 'EXPIRED', currentPeriodEnd: new Date(NOW.getTime() - 10 * DAY) })];
      db.state.memberships.push(activeMember(db, 'user-a', 'user-b'));

      const view = await service.getGroup('user-a');
      expect(view).toMatchObject({ role: 'owner', planActive: false, members: [{ email: 'bruno@exemplo.com' }] });
    });

    it('pagador novo sem membros nem convites: owner com listas vazias', async () => {
      const { service } = build();
      const view = await service.getGroup('user-a');
      expect(view).toMatchObject({ role: 'owner', planActive: true, members: [], invites: [], seats: 2 });
    });

    it('sem membros, sem convites pendentes e sem plano ativo: 404', async () => {
      const { db, service } = build();
      db.state.subs = [];
      await expect(service.getGroup('user-a')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createInvite', () => {
    it('so o token em claro sai na resposta; no banco fica o SHA-256; e-mail normalizado; prazo de 7 dias (D4)', async () => {
      const { db, service } = build();

      const created = await service.createInvite('user-a', { email: '  Dani@Exemplo.COM ' });

      expect(created.email).toBe('dani@exemplo.com');
      expect(created.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(created.expiresAt).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
      expect(db.state.invites).toHaveLength(1);
      const row = db.state.invites[0];
      expect(row.tokenHash).toBe(createHash('sha256').update(created.token).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(created.token);
    });

    it('membro que tenta convidar ouve 403 (D12)', async () => {
      const { db, service } = build();
      db.state.memberships.push(activeMember(db, 'user-a', 'user-b'));
      await expect(service.createInvite('user-b', { email: 'x@y.com' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('pagador sem SHARED ativo nao convida (403), e estranho tambem nao', async () => {
      const { db, service } = build();
      db.state.subs = [sharedSub('user-a', { status: 'EXPIRED', currentPeriodEnd: new Date(NOW.getTime() - DAY) })];
      await expect(service.createInvite('user-a', { email: 'x@y.com' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.createInvite('user-c', { email: 'x@y.com' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('decimo primeiro convite passa do teto de 10 pendentes; revogado libera vaga', async () => {
      const { db, service } = build();
      for (let i = 0; i < 10; i++) {
        await service.createInvite('user-a', { email: `convidado${i}@exemplo.com` });
      }
      await expect(service.createInvite('user-a', { email: 'mais@exemplo.com' })).rejects.toBeInstanceOf(ConflictException);

      const pendente = db.state.invites.find((i: Row) => i.email === 'convidado0@exemplo.com')!;
      pendente.revokedAt = new Date(NOW);
      await expect(service.createInvite('user-a', { email: 'mais@exemplo.com' })).resolves.toBeDefined();
    });
  });

  describe('revokeInvite', () => {
    it('pagador revoga o proprio convite pendente', async () => {
      const { db, service } = build();
      const { row } = pendingInvite(db, 'user-a', 'dani@exemplo.com');

      await service.revokeInvite('user-a', row.id);
      expect(row.revokedAt).toEqual(NOW);
    });

    it('convite de outro pagador ou ja usado: 404 igual e nada alterado', async () => {
      const { db, service } = build();
      const alheio = pendingInvite(db, 'user-z', 'bruno@exemplo.com');
      const usado = pendingInvite(db, 'user-a', 'bruno@exemplo.com');
      usado.row.acceptedAt = new Date(NOW);
      usado.row.acceptedUserId = 'user-b';

      await expect(service.revokeInvite('user-a', alheio.row.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(alheio.row.revokedAt).toBeNull();
      await expect(service.revokeInvite('user-a', usado.row.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('membro que tenta revogar ouve 403', async () => {
      const { db, service } = build();
      db.state.memberships.push(activeMember(db, 'user-a', 'user-b'));
      const { row } = pendingInvite(db, 'user-a', 'dani@exemplo.com');
      await expect(service.revokeInvite('user-b', row.id)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('acceptInvite', () => {
    it('convidado com o mesmo e-mail entra: membro criado, convite consumido, visao de membro devolvida', async () => {
      const { db, service } = build();
      const { row, token } = pendingInvite(db, 'user-a', 'dani@exemplo.com');

      const view = await service.acceptInvite('user-d', token);

      expect(view).toEqual({ role: 'member', ownerFirstName: 'Ana', joinedAt: NOW.toISOString() });
      expect(db.state.memberships).toHaveLength(1);
      expect(db.state.memberships[0]).toMatchObject({ ownerUserId: 'user-a', memberUserId: 'user-d', leftAt: null });
      expect(row.acceptedAt).toEqual(NOW);
      expect(row.acceptedUserId).toBe('user-d');
    });

    it.each([
      ['desconhecido', (db: any) => 'token-que-nao-existe-no-banco-0000000000'],
      ['expirado', (db: any) => {
        const { token } = pendingInvite(db, 'user-a', 'dani@exemplo.com');
        db.state.invites[0].expiresAt = new Date(NOW.getTime() - 1);
        return token;
      }],
      ['revogado', (db: any) => {
        const { token } = pendingInvite(db, 'user-a', 'dani@exemplo.com');
        db.state.invites[0].revokedAt = new Date(NOW);
        return token;
      }],
      ['consumido', (db: any) => {
        const { token } = pendingInvite(db, 'user-a', 'dani@exemplo.com');
        db.state.invites[0].acceptedAt = new Date(NOW);
        return token;
      }],
      ['e-mail que nao e do logado', (db: any) => {
        const { token } = pendingInvite(db, 'user-a', 'outra@exemplo.com');
        return token;
      }],
    ])('convite %s: 404 com a MESMA mensagem e nada gravado (D12)', async (_nome, preparar) => {
      const { db, service } = build();
      const token = preparar(db);

      const err = await errorOf(service.acceptInvite('user-d', token));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe(INVALID);
      expect(db.state.memberships).toHaveLength(0);
    });

    it('pagador com plano proprio ativo nao entra (409) e o convite fica livre', async () => {
      const { db, service } = build();
      db.state.subs.push({ ownerUserId: 'user-d', plan: 'INDIVIDUAL', status: 'ACTIVE', source: 'GRANT', currentPeriodEnd: null });
      const { row, token } = pendingInvite(db, 'user-a', 'dani@exemplo.com');

      await expect(service.acceptInvite('user-d', token)).rejects.toBeInstanceOf(ConflictException);
      expect(row.acceptedAt).toBeNull();
      expect(db.state.memberships).toHaveLength(0);
    });

    it('quem ainda e dono de um grupo ativo (mesmo com o plano caido) nao entra em outro (409)', async () => {
      const { db, service } = build();
      db.state.subs.push(sharedSub('user-d', { status: 'EXPIRED', currentPeriodEnd: new Date(NOW.getTime() - 10 * DAY) }));
      db.state.memberships.push(activeMember(db, 'user-d', 'user-c'));
      const { token } = pendingInvite(db, 'user-a', 'dani@exemplo.com');

      await expect(service.acceptInvite('user-d', token)).rejects.toBeInstanceOf(ConflictException);
    });

    it('grupo com plano caido nao aceita gente nova (409) e o convite sobrevive (D11)', async () => {
      const { db, service } = build();
      db.state.subs = [sharedSub('user-a', { status: 'PAST_DUE', currentPeriodEnd: new Date(NOW.getTime() - 8 * DAY) })];
      const { row, token } = pendingInvite(db, 'user-a', 'dani@exemplo.com');

      await expect(service.acceptInvite('user-d', token)).rejects.toBeInstanceOf(ConflictException);
      expect(row.acceptedAt).toBeNull();
    });

    it('lugar ocupado (seats=2 => 1 membro): aceite extra ouve 409 (D2)', async () => {
      const { db, service } = build();
      db.state.memberships.push(activeMember(db, 'user-a', 'user-b'));
      const { token } = pendingInvite(db, 'user-a', 'dani@exemplo.com');

      await expect(service.acceptInvite('user-d', token)).rejects.toBeInstanceOf(ConflictException);
      expect(db.state.memberships.filter((m: Row) => m.leftAt === null)).toHaveLength(1);
    });

    it('entrar sai do grupo anterior automaticamente (D5)', async () => {
      const { db, service } = build();
      db.state.subs.push(sharedSub('user-z'));
      const antiga = activeMember(db, 'user-z', 'user-d');
      db.state.memberships.push(antiga);
      const { token } = pendingInvite(db, 'user-a', 'dani@exemplo.com');

      await service.acceptInvite('user-d', token);
      expect(antiga.leftAt).toEqual(NOW);
      expect(db.state.memberships.filter((m: Row) => m.leftAt === null)).toEqual([
        expect.objectContaining({ ownerUserId: 'user-a', memberUserId: 'user-d' }),
      ]);
    });

    it('corrida de membership (unico parcial): 409 orientando recarregar', async () => {
      const { db, service } = build();
      const { token } = pendingInvite(db, 'user-a', 'dani@exemplo.com');
      const real = db.groupMembership.create;
      db.groupMembership.create = async () => {
        throw new Prisma.PrismaClientKnownRequestError('dup key', { code: 'P2002', clientVersion: '5.22.0' });
      };
      const err = await errorOf(service.acceptInvite('user-d', token));
      expect(err).toBeInstanceOf(ConflictException);
      db.groupMembership.create = real;
    });
  });

  describe('leave', () => {
    it('membro sai e pode ser re-aceito depois; sem grupo: 404', async () => {
      const { db, service } = build();
      const membre = activeMember(db, 'user-a', 'user-b');
      db.state.memberships.push(membre);

      await service.leave('user-b');
      expect(membre.leftAt).toEqual(NOW);
      await expect(service.leave('user-b')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.leave('user-a')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeMember', () => {
    it('pagador remove membro; id de outro grupo ou inexistente e 404; membro que tenta remover ouve 403 (D12)', async () => {
      const { db, service } = build();
      const membre = activeMember(db, 'user-a', 'user-b');
      db.state.memberships.push(membre, activeMember(db, 'user-z', 'user-d'));
      db.state.subs.push(sharedSub('user-z'));

      await service.removeMember('user-a', membre.id);
      expect(membre.leftAt).toEqual(NOW);

      const alheia = db.state.memberships[1];
      await expect(service.removeMember('user-a', alheia.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.removeMember('user-a', 'member-inexistente')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.removeMember('user-b', 'qualquer')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('pagador nao consegue remover a si mesmo: nao existe linha de membro dele', async () => {
      const { db, service } = build();
      db.state.memberships.push(activeMember(db, 'user-a', 'user-b'));

      await expect(service.removeMember('user-a', 'user-a')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
