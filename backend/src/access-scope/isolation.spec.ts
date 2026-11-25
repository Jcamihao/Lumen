import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { EntitlementsService } from '../billing/entitlements.service';
import { GroupService } from '../billing/group.service';
import { FinanceCategoriesService, toPrivacyCategoryExport } from '../finance-categories/finance-categories.service';
import { TransactionsService } from '../transactions/transactions.service';
import { toPrivacyTransactionExport } from '../transactions/shared-transaction.view';
import { AccessScopeService } from './access-scope.service';
import { createSharedFakeDb, Row } from './shared-fake-db.fixture';

/*
 * Isolamento do contrato 11b-1a com 4 contas: A (pagador) e B (membro) no grupo de A (plano SHARED);
 * C (membro do grupo de Z, outro grupo); D (sem grupo, FREE). Servicos reais sobre um banco em memoria.
 */

const NOW = new Date('2026-11-25T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const OUT_OF_SCOPE = 'Transacao nao encontrada.';

function setup() {
  const { db, state } = createSharedFakeDb(NOW);
  state.users.push(
    { id: 'user-a', email: 'ana@exemplo.com', name: 'Ana Beatriz Souza' },
    { id: 'user-b', email: 'bruno@exemplo.com', name: 'Bruno Lima' },
    { id: 'user-c', email: 'carla@exemplo.com', name: 'Carla Dias' },
    { id: 'user-d', email: 'dani@exemplo.com', name: 'Dani Lima' },
    { id: 'user-z', email: 'zoe@exemplo.com', name: 'Zoe Prado' },
  );
  const sharedSub = (ownerUserId: string) => ({
    ownerUserId,
    plan: 'SHARED',
    status: 'ACTIVE',
    source: 'ASAAS',
    currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY),
  });
  state.subs.push(sharedSub('user-a'), sharedSub('user-z'));
  const membership = (id: string, ownerUserId: string, memberUserId: string) => ({
    id,
    ownerUserId,
    memberUserId,
    joinedAt: NOW,
    leftAt: null,
    createdAt: NOW,
  });
  state.memberships.push(membership('m-b', 'user-a', 'user-b'), membership('m-c', 'user-z', 'user-c'));

  const life = { touchUserData: jest.fn().mockResolvedValue(undefined) };
  const materializer = { materializeDue: jest.fn().mockResolvedValue(0) };
  const entitlements = new EntitlementsService(db as any, { get: jest.fn() } as any);
  const access = new AccessScopeService(db as any, entitlements);
  const transactions = new TransactionsService(db as any, life as any, materializer as any, materializer as any, access);
  const categories = new FinanceCategoriesService(db as any, life as any, access);
  const groups = new GroupService(db as any);
  return { db, state, transactions, categories, groups, life };
}

type Ctx = ReturnType<typeof setup>;

async function expectRejection(promise: Promise<unknown>, type: new (...args: any[]) => Error, message?: string) {
  const error = await promise.then(
    () => {
      throw new Error('esperava erro');
    },
    (e: Error) => e,
  );
  expect(error).toBeInstanceOf(type);
  if (message !== undefined) expect(error.message).toBe(message);
  return error as any;
}

const createTx = (ctx: Ctx, userId: string, description: string, categoryId?: string) =>
  ctx.transactions.create(userId, { type: 'EXPENSE', description, amount: 50, date: '2026-11-20', categoryId } as any);

describe('compartilhamento isolado: A e B no grupo, C em outro grupo, D sem grupo (contrato 11b-1a)', () => {
  it('padrao mine: resposta sem campos de compartilhamento e so do proprio usuario', async () => {
    const ctx = setup();
    const a1 = await createTx(ctx, 'user-a', 'mercado privado');
    const a2 = await createTx(ctx, 'user-a', 'almoco compartilhado');
    await ctx.transactions.setSharing('user-a', a2.id, true);

    const mine = await ctx.transactions.list('user-a', {} as any);
    expect(mine.map((t: any) => t.id).sort()).toEqual([a1.id, a2.id].sort());
    for (const item of mine) {
      expect(item).not.toHaveProperty('sharedGroupOwnerId');
      expect(item).not.toHaveProperty('isShared');
    }
    expect(await ctx.transactions.list('user-b', {} as any)).toEqual([]);
  });

  it('escopo shared: parceiro ve so o item marcado, com primeiro nome e sem dado do autor', async () => {
    const ctx = setup();
    const a1 = await createTx(ctx, 'user-a', 'privado');
    const a2 = await createTx(ctx, 'user-a', 'compartilhado');
    await ctx.transactions.setSharing('user-a', a2.id, true);

    const seenByB = await ctx.transactions.list('user-b', { scope: 'shared' } as any);
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]).toMatchObject({ id: a2.id, isShared: true, isMine: false, sharedByName: 'Ana', cardName: null });
    expect(seenByB[0]).not.toHaveProperty('userId');
    expect(seenByB[0]).not.toHaveProperty('sharedGroupOwnerId');
    expect(seenByB.map((t: any) => t.id)).not.toContain(a1.id);
    expect(JSON.stringify(seenByB)).not.toContain('ana@exemplo.com');
  });

  it('categoria do parceiro e so nome e cor, e o id de categoria privada do autor nao aparece', async () => {
    const ctx = setup();
    const privateCategory = await ctx.categories.create('user-a', { name: 'Mercado', color: '#0f0', type: 'EXPENSE' } as any);
    const a2 = await createTx(ctx, 'user-a', 'compra', privateCategory.id);
    await ctx.transactions.setSharing('user-a', a2.id, true);

    const [view] = await ctx.transactions.list('user-b', { scope: 'shared' } as any);
    expect(view.category).toEqual({ name: 'Mercado', color: '#0f0' });
    expect(view).not.toHaveProperty('categoryId');
    expect(JSON.stringify(view)).not.toContain(privateCategory.id);
  });

  it('escopo all soma o proprio e o do parceiro, cada um com a marca certa', async () => {
    const ctx = setup();
    const a2 = await createTx(ctx, 'user-a', 'de A');
    const b1 = await createTx(ctx, 'user-b', 'de B privado');
    const b2 = await createTx(ctx, 'user-b', 'de B compartilhado');
    await ctx.transactions.setSharing('user-a', a2.id, true);
    await ctx.transactions.setSharing('user-b', b2.id, true);

    const all = await ctx.transactions.list('user-b', { scope: 'all' } as any);
    const byId = Object.fromEntries(all.map((t: any) => [t.id, t]));
    expect(Object.keys(byId).sort()).toEqual([a2.id, b1.id, b2.id].sort());
    expect(byId[b1.id]).toMatchObject({ isMine: true, isShared: false, sharedByName: null });
    expect(byId[b2.id]).toMatchObject({ isMine: true, isShared: true });
    expect(byId[a2.id]).toMatchObject({ isMine: false, isShared: true, sharedByName: 'Ana' });
  });

  it('C (outro grupo) e D (sem grupo) nunca veem nada de A ou B em nenhum escopo', async () => {
    const ctx = setup();
    const a2 = await createTx(ctx, 'user-a', 'de A');
    await ctx.transactions.setSharing('user-a', a2.id, true);
    const cOwn = await createTx(ctx, 'user-c', 'de C');
    const dOwn = await createTx(ctx, 'user-d', 'de D');

    for (const reader of ['user-c', 'user-d']) {
      expect((await ctx.transactions.list(reader, { scope: 'shared' } as any))).toEqual([]);
      const all = await ctx.transactions.list(reader, { scope: 'all' } as any);
      expect(all.map((t: any) => t.id)).not.toContain(a2.id);
    }
    expect((await ctx.transactions.list('user-c', { scope: 'all' } as any)).map((t: any) => t.id)).toEqual([cOwn.id]);
    expect((await ctx.transactions.list('user-d', { scope: 'all' } as any)).map((t: any) => t.id)).toEqual([dOwn.id]);
    await expectRejection(ctx.transactions.update('user-c', a2.id, { description: 'x' } as any), NotFoundException, OUT_OF_SCOPE);
    await expectRejection(ctx.transactions.remove('user-d', a2.id), NotFoundException, OUT_OF_SCOPE);
  });

  it('marcar e so do autor; marcar exige grupo ativo (409 com codigo); marcar de novo e idempotente', async () => {
    const ctx = setup();
    const a2 = await createTx(ctx, 'user-a', 'de A');
    await expectRejection(ctx.transactions.setSharing('user-b', a2.id, true), NotFoundException, OUT_OF_SCOPE);

    const dOwn = await createTx(ctx, 'user-d', 'de D');
    const conflict = await expectRejection(ctx.transactions.setSharing('user-d', dOwn.id, true), ConflictException);
    expect(conflict.getResponse()).toMatchObject({ code: 'SHARING_NEEDS_ACTIVE_GROUP' });

    const first = await ctx.transactions.setSharing('user-a', a2.id, true);
    const second = await ctx.transactions.setSharing('user-a', a2.id, true);
    expect(first).toEqual({ id: a2.id, isShared: true, updatedAt: expect.any(String) });
    expect(second).toEqual(first);
    expect((await ctx.transactions.setSharing('user-d', dOwn.id, false))).toMatchObject({ isShared: false });
  });

  it('parceiro edita e apaga o item compartilhado; o autor continua o mesmo e os campos restritos dao 403', async () => {
    const ctx = setup();
    const privateCategory = await ctx.categories.create('user-a', { name: 'Privada', color: '#111', type: 'EXPENSE' } as any);
    const sharedCategory = await ctx.categories.create('user-a', { name: 'Casa', color: '#222', type: 'EXPENSE' } as any);
    await ctx.categories.setSharing('user-a', sharedCategory.id, true);
    const a2 = await createTx(ctx, 'user-a', 'antes');
    await ctx.transactions.setSharing('user-a', a2.id, true);

    const edited = await ctx.transactions.update('user-b', a2.id, { description: 'depois' } as any);
    expect(edited).toMatchObject({ id: a2.id, description: 'depois', isMine: false, sharedByName: 'Ana' });
    expect(ctx.state.transactions.find((t) => t.id === a2.id)?.userId).toBe('user-a');

    const restricted = await expectRejection(ctx.transactions.update('user-b', a2.id, { type: 'INCOME' } as any), ForbiddenException);
    expect(restricted.getResponse()).toMatchObject({ code: 'PARTNER_EDIT_RESTRICTED' });
    await expectRejection(ctx.transactions.update('user-b', a2.id, { envelopeId: 'env-x' } as any), ForbiddenException);
    await expectRejection(ctx.transactions.update('user-b', a2.id, { cardId: 'card-x' } as any), ForbiddenException);

    await expectRejection(
      ctx.transactions.update('user-b', a2.id, { categoryId: privateCategory.id } as any),
      NotFoundException,
      'Categoria financeira invalida.',
    );
    const withShared = await ctx.transactions.update('user-b', a2.id, { categoryId: sharedCategory.id } as any);
    expect(withShared.category).toEqual({ name: 'Casa', color: '#222' });

    await ctx.transactions.remove('user-b', a2.id);
    expect(ctx.state.transactions.find((t) => t.id === a2.id)).toBeUndefined();
  });

  it('categoria compartilhada de outro grupo, sem grupo ou sem plano: 404 igual ao inexistente em editar, excluir e marcar', async () => {
    const ctx = setup();
    const shared = await ctx.categories.create('user-a', { name: 'Casa', color: '#222', type: 'EXPENSE' } as any);
    await ctx.categories.setSharing('user-a', shared.id, true);
    const missing = await expectRejection(ctx.categories.remove('user-c', 'categoria-inexistente'), NotFoundException);

    for (const reader of ['user-c', 'user-d']) {
      const removed = await expectRejection(ctx.categories.remove(reader, shared.id), NotFoundException);
      expect(removed.message).toBe(missing.message);
      await expectRejection(ctx.categories.update(reader, shared.id, { name: 'Hack' } as any), NotFoundException);
      await expectRejection(ctx.categories.setSharing(reader, shared.id, false), NotFoundException);
    }
    expect(ctx.state.categories.find((c) => c.id === shared.id)?.sharedGroupOwnerId).toBe('user-a');
  });

  it('parceiro nunca poe categoria propria (privada ou compartilhada) no lancamento do autor', async () => {
    const ctx = setup();
    const own = await ctx.categories.create('user-b', { name: 'DoBeto', color: '#333', type: 'EXPENSE', monthlyBudget: 333 } as any);
    const ownShared = await ctx.categories.create('user-b', { name: 'DoBetoComp', color: '#444', type: 'EXPENSE' } as any);
    await ctx.categories.setSharing('user-b', ownShared.id, true);
    const a2 = await createTx(ctx, 'user-a', 'antes');
    await ctx.transactions.setSharing('user-a', a2.id, true);

    for (const category of [own, ownShared]) {
      await expectRejection(
        ctx.transactions.update('user-b', a2.id, { categoryId: category.id } as any),
        NotFoundException,
        'Categoria financeira invalida.',
      );
    }
    expect(ctx.state.transactions.find((t) => t.id === a2.id)?.categoryId ?? null).toBeNull();
  });

  it('parceiro nao apaga nem edita item privado do autor (404 igual ao inexistente)', async () => {
    const ctx = setup();
    const a1 = await createTx(ctx, 'user-a', 'privado');
    const missing = await expectRejection(ctx.transactions.update('user-b', 'tx-inexistente', { description: 'x' } as any), NotFoundException);
    const hidden = await expectRejection(ctx.transactions.update('user-b', a1.id, { description: 'x' } as any), NotFoundException);
    expect(hidden.message).toBe(missing.message);
    await expectRejection(ctx.transactions.remove('user-b', a1.id), NotFoundException, OUT_OF_SCOPE);
  });

  it('item desmarcado some para o parceiro e a resposta fica igual a de item inexistente', async () => {
    const ctx = setup();
    const a2 = await createTx(ctx, 'user-a', 'era compartilhado');
    await ctx.transactions.setSharing('user-a', a2.id, true);
    await ctx.transactions.setSharing('user-a', a2.id, false);

    expect(await ctx.transactions.list('user-b', { scope: 'shared' } as any)).toEqual([]);
    await expectRejection(ctx.transactions.update('user-b', a2.id, { description: 'x' } as any), NotFoundException, OUT_OF_SCOPE);
  });

  it('queda do plano do pagador pausa o compartilhamento para todos, sem apagar nada', async () => {
    const ctx = setup();
    const a2 = await createTx(ctx, 'user-a', 'compartilhado');
    await ctx.transactions.setSharing('user-a', a2.id, true);
    const sub = ctx.state.subs.find((s) => s.ownerUserId === 'user-a');
    Object.assign(sub, { status: 'CANCELED', currentPeriodEnd: new Date(NOW.getTime() - DAY) });

    expect(await ctx.transactions.list('user-b', { scope: 'shared' } as any)).toEqual([]);
    await expectRejection(ctx.transactions.update('user-b', a2.id, { description: 'x' } as any), NotFoundException, OUT_OF_SCOPE);
    expect((await ctx.transactions.list('user-a', {} as any)).map((t: any) => t.id)).toEqual([a2.id]);
    expect(ctx.state.transactions.find((t) => t.id === a2.id)?.sharedGroupOwnerId).toBe('user-a');

    Object.assign(sub, { status: 'ACTIVE', currentPeriodEnd: new Date(NOW.getTime() + DAY) });
    expect((await ctx.transactions.list('user-b', { scope: 'shared' } as any)).map((t: any) => t.id)).toEqual([a2.id]);
  });

  it('ex-membro: ao sair, os itens que ele marcou voltam a ser privados e somem para o grupo', async () => {
    const ctx = setup();
    const b2 = await createTx(ctx, 'user-b', 'de B');
    await ctx.transactions.setSharing('user-b', b2.id, true);
    expect((await ctx.transactions.list('user-a', { scope: 'shared' } as any)).map((t: any) => t.id)).toEqual([b2.id]);

    await ctx.groups.leave('user-b');

    expect(ctx.state.transactions.find((t) => t.id === b2.id)?.sharedGroupOwnerId).toBeNull();
    expect(await ctx.transactions.list('user-a', { scope: 'shared' } as any)).toEqual([]);
    expect((await ctx.transactions.list('user-b', { scope: 'all' } as any)).map((t: any) => t.id)).toEqual([b2.id]);
    await expectRejection(ctx.transactions.setSharing('user-b', b2.id, true), ConflictException);
  });

  it('pagador remove membro: os itens do membro saem do grupo na mesma operacao', async () => {
    const ctx = setup();
    const c1 = await createTx(ctx, 'user-c', 'de C no grupo de Z');
    await ctx.transactions.setSharing('user-c', c1.id, true);
    expect((await ctx.transactions.list('user-z', { scope: 'shared' } as any)).map((t: any) => t.id)).toEqual([c1.id]);

    await ctx.groups.removeMember('user-z', 'm-c');

    expect(ctx.state.transactions.find((t) => t.id === c1.id)?.sharedGroupOwnerId).toBeNull();
    expect(await ctx.transactions.list('user-z', { scope: 'shared' } as any)).toEqual([]);
  });

  it('corrida: parceiro sai do grupo entre a checagem e a escrita; a edicao nao grava', async () => {
    const ctx = setup();
    const a2 = await createTx(ctx, 'user-a', 'original');
    await ctx.transactions.setSharing('user-a', a2.id, true);
    ctx.state.beforeLock = () => ctx.groups.leave('user-b');

    await expectRejection(ctx.transactions.update('user-b', a2.id, { description: 'tardia' } as any), NotFoundException, OUT_OF_SCOPE);
    expect(ctx.state.transactions.find((t) => t.id === a2.id)?.description).toBe('original');
  });

  it('corrida: autor desmarca no meio da edicao do parceiro; a edicao nao grava', async () => {
    const ctx = setup();
    const a2 = await createTx(ctx, 'user-a', 'original');
    await ctx.transactions.setSharing('user-a', a2.id, true);
    ctx.state.beforeLock = () => ctx.transactions.setSharing('user-a', a2.id, false).then(() => undefined);

    await expectRejection(ctx.transactions.update('user-b', a2.id, { description: 'tardia' } as any), NotFoundException, OUT_OF_SCOPE);
    expect(ctx.state.transactions.find((t) => t.id === a2.id)?.description).toBe('original');
  });

  it('categorias: parceiro ve a compartilhada (sem orcamento), so renomeia/recolore, nao apaga; privada e 404', async () => {
    const ctx = setup();
    const shared = await ctx.categories.create('user-a', { name: 'Casa', color: '#333', type: 'EXPENSE', monthlyBudget: 500, icon: null } as any);
    const privateCat = await ctx.categories.create('user-a', { name: 'Minha', color: '#444', type: 'EXPENSE' } as any);
    await ctx.categories.setSharing('user-a', shared.id, true);

    expect(await ctx.categories.list('user-b', 'shared')).toEqual([
      { id: shared.id, name: 'Casa', color: '#333', icon: null, type: 'EXPENSE', isShared: true, isMine: false, sharedByName: 'Ana' },
    ]);
    expect(await ctx.categories.list('user-b')).toEqual([]);

    const renamed = await ctx.categories.update('user-b', shared.id, { name: 'Casa nova' } as any);
    expect(renamed).toMatchObject({ id: shared.id, name: 'Casa nova', isMine: false });
    const budget = await expectRejection(ctx.categories.update('user-b', shared.id, { monthlyBudget: 9 } as any), ForbiddenException);
    expect(budget.getResponse()).toMatchObject({ code: 'PARTNER_EDIT_RESTRICTED' });
    await expectRejection(ctx.categories.remove('user-b', shared.id), ForbiddenException);
    await expectRejection(ctx.categories.update('user-b', privateCat.id, { name: 'x' } as any), NotFoundException, 'Categoria financeira nao encontrada.');
  });

  it('apagar categoria compartilhada tira a categoria tambem dos lancamentos do parceiro', async () => {
    const ctx = setup();
    const shared = await ctx.categories.create('user-a', { name: 'Casa', color: '#333', type: 'EXPENSE' } as any);
    await ctx.categories.setSharing('user-a', shared.id, true);
    const a2 = await createTx(ctx, 'user-a', 'compra', shared.id);
    await ctx.transactions.setSharing('user-a', a2.id, true);

    await ctx.categories.remove('user-a', shared.id);

    expect(ctx.state.transactions.find((t) => t.id === a2.id)?.categoryId).toBeNull();
  });

  it('listagem de categorias: o autor ve a propria com a marca e sem o campo interno', async () => {
    const ctx = setup();
    const own = await ctx.categories.create('user-a', { name: 'Casa', color: '#333', type: 'EXPENSE' } as any);
    await ctx.categories.setSharing('user-a', own.id, true);

    const [mine] = await ctx.categories.list('user-a');
    expect(mine).not.toHaveProperty('sharedGroupOwnerId');
    const [all] = await ctx.categories.list('user-a', 'all');
    expect(all).toMatchObject({ isMine: true, isShared: true, sharedByName: null });
  });

  it('padrao mine usa so o userId do token no where (saldo e agregados do parceiro ficam fora)', async () => {
    const ctx = setup();
    const a2 = await createTx(ctx, 'user-a', 'de A');
    await ctx.transactions.setSharing('user-a', a2.id, true);
    const spy = jest.spyOn(ctx.db.transaction, 'findMany') as jest.SpyInstance<any, any[]>;

    expect(await ctx.transactions.list('user-b', {} as any)).toEqual([]);
    expect(spy.mock.calls[0][0].where).toEqual({ userId: 'user-b' });
  });

  it('exportacao LGPD: cada item proprio traz shared e nao traz a marca interna', async () => {
    const ctx = setup();
    const a1 = await createTx(ctx, 'user-a', 'privado');
    const a2 = await createTx(ctx, 'user-a', 'compartilhado');
    await ctx.transactions.setSharing('user-a', a2.id, true);
    const rows = ctx.state.transactions.filter((t) => t.userId === 'user-a');

    const exported = rows.map((row) => toPrivacyTransactionExport({ ...row, category: null } as any));
    const byId = Object.fromEntries(exported.map((t) => [t.id, t]));
    expect(byId[a1.id]).toMatchObject({ shared: false });
    expect(byId[a2.id]).toMatchObject({ shared: true });
    expect(byId[a2.id]).not.toHaveProperty('sharedGroupOwnerId');
    const category = await ctx.categories.create('user-a', { name: 'Casa', color: '#333', type: 'EXPENSE' } as any);
    await ctx.categories.setSharing('user-a', category.id, true);
    const exportedCategory = toPrivacyCategoryExport(ctx.state.categories.find((c) => c.id === category.id) as any);
    expect(exportedCategory).toMatchObject({ shared: true });
    expect(exportedCategory).not.toHaveProperty('sharedGroupOwnerId');
    expect(toPrivacyCategoryExport({ ...exportedCategory, sharedGroupOwnerId: null } as any)).toMatchObject({ shared: false });
  });

  it('ordem de locks: a linha do User do autor e travada antes da leitura do item', async () => {
    const ctx = setup();
    const a2 = await createTx(ctx, 'user-a', 'original');
    await ctx.transactions.setSharing('user-a', a2.id, true);
    const spy = jest.spyOn(ctx.db, '$queryRaw');

    await ctx.transactions.update('user-b', a2.id, { description: 'nova' } as any);

    const sqls = spy.mock.calls.map((call) => (call[0] as unknown as string[]).join('?'));
    expect(sqls[0]).toContain('"User"');
    expect(sqls[1]).toContain('"Transaction"');
    spy.mockClear();
    await ctx.transactions.setSharing('user-a', a2.id, false);
    expect((spy.mock.calls[0]?.[0] as unknown as string[] | undefined)?.join('?') ?? '').toContain('"User"');
  });

  it('ordem de locks: remocao pelo parceiro trava o User do autor antes do item', async () => {
    const ctx = setup();
    const a2 = await createTx(ctx, 'user-a', 'original');
    await ctx.transactions.setSharing('user-a', a2.id, true);
    const spy = jest.spyOn(ctx.db, '$queryRaw');

    await ctx.transactions.remove('user-b', a2.id);

    const sqls = spy.mock.calls.map((call) => (call[0] as unknown as string[]).join('?'));
    expect(sqls[0]).toContain('"User"');
    expect(sqls[1]).toContain('"Transaction"');
  });

  it('aceite de convite em outro grupo: os itens do membro saem do grupo anterior na mesma operacao', async () => {
    const ctx = setup();
    ctx.state.users.push({ id: 'user-e', email: 'eva@exemplo.com', name: 'Eva' });
    ctx.state.subs.push({
      ownerUserId: 'user-e',
      plan: 'SHARED',
      status: 'ACTIVE',
      source: 'ASAAS',
      currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY),
    });
    const b2 = await createTx(ctx, 'user-b', 'de B');
    await ctx.transactions.setSharing('user-b', b2.id, true);
    const invite = await ctx.groups.createInvite('user-e', { email: 'bruno@exemplo.com' } as any);

    await ctx.groups.acceptInvite('user-b', invite.token);

    expect(ctx.state.transactions.find((t) => t.id === b2.id)?.sharedGroupOwnerId).toBeNull();
    expect(ctx.state.memberships.filter((m) => m.memberUserId === 'user-b' && m.leftAt === null).map((m) => m.ownerUserId)).toEqual(['user-e']);
    expect(await ctx.transactions.list('user-a', { scope: 'shared' } as any)).toEqual([]);
  });

  it('quem nao esta mais no grupo nao ve item marcado com o grupo (autor fora do grupo)', async () => {
    const ctx = setup();
    const c1 = await createTx(ctx, 'user-c', 'de C');
    ctx.state.transactions.find((t) => t.id === c1.id)!.sharedGroupOwnerId = 'user-a';

    expect(await ctx.transactions.list('user-b', { scope: 'shared' } as any)).toEqual([]);
    await expectRejection(ctx.transactions.update('user-b', c1.id, { description: 'x' } as any), NotFoundException, OUT_OF_SCOPE);
  });

  it('exclusao de conta: o parceiro deixa de ver os itens (o modelo tem cascade no dono e SET NULL na marca)', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const transactionModel = schema.slice(schema.indexOf('model Transaction {'));
    expect(transactionModel).toMatch(/sharedGroupOwner\s+User\?\s+@relation\("SharedTransactionGroup".*onDelete: SetNull\)/);
    expect(transactionModel).toMatch(/user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/);
    const categoryModel = schema.slice(schema.indexOf('model FinanceCategory {'));
    expect(categoryModel).toMatch(/sharedGroupOwner\s+User\?\s+@relation\("SharedFinanceCategoryGroup".*onDelete: SetNull\)/);
  });
});
