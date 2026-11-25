/* Banco em memoria para testes de isolamento (contrato 11b). Nao e Prisma: so o subset usado pelos servicos. */
import { Prisma } from '@prisma/client';

export type Row = Record<string, any>;

/** Igualdade, null, {in}, {not}, {gt}, datas e OR, como o Prisma avalia no where. */
export function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'OR') return (cond as Row[]).some((branch) => matches(row, branch));
    if (key === 'AND') return (cond as Row[]).every((branch) => matches(row, branch));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return value?.getTime() === cond.getTime();
    if (cond && typeof cond === 'object') {
      if ('in' in cond) return (cond.in as unknown[]).includes(value);
      if ('not' in cond) return cond.not === null ? value !== null && value !== undefined : value !== cond.not;
      if ('gt' in cond) return new Date(value).getTime() > new Date(cond.gt).getTime();
      if ('lte' in cond) return new Date(value).getTime() <= new Date(cond.lte).getTime();
      return false;
    }
    return value === cond;
  });
}

export function createSharedFakeDb(clockStart: Date) {
  let tick = 0;
  let seq = 0;
  const now = () => new Date(clockStart.getTime() + ++tick);
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const state = {
    users: [] as Row[],
    subs: [] as Row[],
    memberships: [] as Row[],
    invites: [] as Row[],
    transactions: [] as Row[],
    categories: [] as Row[],
    cards: [] as Row[],
    /** Gancho executado antes de cada leitura com FOR NO KEY UPDATE (simula a corrida entre escritores). */
    beforeLock: null as null | (() => Promise<void>),
  };

  const apply = (row: Row, data: Row) => {
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) row[key] = value;
    });
    row.updatedAt = now();
  };

  const withRelations = (row: Row, include?: Row): Row => {
    if (!include) return row;
    const out: Row = { ...row };
    if (include.category) out.category = state.categories.find((c) => c.id === row.categoryId) ?? null;
    if (include.envelope) out.envelope = null;
    if (include.card) out.card = null;
    return out;
  };

  /** defaults: valores que o Prisma grava quando o create nao traz o campo (colunas NULL e padroes). */
  const table = (rows: Row[], prefix: string, relations?: (row: Row, include?: Row) => Row, defaults: Row = {}) => {
    const decorate = (row: Row, include?: Row) => (relations ? relations(row, include) : row);
    const find = (where?: Row) => rows.filter((row) => matches(row, where));
    return {
      findMany: async ({ where, include }: Row = {}) => find(where).map((row) => decorate(row, include)),
      findFirst: async ({ where, include }: Row = {}) => {
        const row = find(where)[0];
        return row ? decorate(row, include) : null;
      },
      count: async ({ where }: Row = {}) => find(where).length,
      findUnique: async ({ where }: Row) => find(where)[0] ?? null,
      create: async ({ data }: Row) => {
        const row: Row = { id: nextId(prefix), createdAt: now(), updatedAt: now(), ...defaults, ...data };
        rows.push(row);
        return decorate(row);
      },
      update: async ({ where, data, include }: Row) => {
        const row = rows.find((r) => matches(r, where));
        if (!row) throw new Error(`update sem linha em ${prefix}`);
        apply(row, data);
        return decorate(row, include);
      },
      updateMany: async ({ where, data }: Row) => {
        const targets = find(where);
        targets.forEach((row) => apply(row, data));
        return { count: targets.length };
      },
      delete: async ({ where }: Row) => {
        const index = rows.findIndex((r) => matches(r, where));
        const [removed] = rows.splice(index, 1);
        return removed;
      },
    };
  };

  const db: Row = {
    state,
    user: {
      findMany: async ({ where, select }: Row) =>
        state.users
          .filter((u) => matches(u, where))
          .map((u) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, u[k]])) : u)),
      findUnique: async ({ where, select }: Row) => {
        const u = state.users.find((x) => matches(x, where)) ?? null;
        if (!u || !select) return u;
        return Object.fromEntries(Object.keys(select).map((k) => [k, u[k]]));
      },
    },
    subscription: {
      findMany: async ({ where }: Row = {}) => state.subs.filter((s) => matches(s, where)),
    },
    groupMembership: table(state.memberships, 'membership', undefined, { leftAt: null, joinedAt: clockStart }),
    groupInvite: table(state.invites, 'invite', undefined, { revokedAt: null, acceptedAt: null, acceptedUserId: null }),
    transaction: table(state.transactions, 'tx', withRelations, { sharedGroupOwnerId: null }),
    financeCategory: table(state.categories, 'cat', undefined, { sharedGroupOwnerId: null, icon: null }),
    creditCard: table(state.cards, 'card', undefined, { sharedGroupOwnerId: null, archivedAt: null }),
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      const id = values[0];
      const locksItem = sql.includes('"Transaction"') || sql.includes('"FinanceCategory"');
      if (locksItem && state.beforeLock) {
        const hook = state.beforeLock;
        state.beforeLock = null;
        await hook();
      }
      if (sql.includes('"Transaction"')) return state.transactions.filter((t) => t.id === id);
      if (sql.includes('"FinanceCategory"')) return state.categories.filter((c) => c.id === id);
      return [{ id }];
    },
    $transaction: async (fn: (tx: Row) => Promise<unknown>) => fn(db),
  };
  return { db, state, Prisma };
}
