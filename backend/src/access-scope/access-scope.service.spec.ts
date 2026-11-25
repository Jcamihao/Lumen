import { ConflictException } from '@nestjs/common';
import { EntitlementsService } from '../billing/entitlements.service';
import { AccessScopeService, SHARING_NEEDS_ACTIVE_GROUP_CODE } from './access-scope.service';
import { buildScopeWhere, NO_ACCESS_VIEW } from './read-scope';
import { createSharedFakeDb } from './shared-fake-db.fixture';

const NOW = new Date('2026-11-25T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function build() {
  const { db, state } = createSharedFakeDb(NOW);
  state.users.push(
    { id: 'user-a', name: 'Ana Beatriz Souza' },
    { id: 'user-b', name: '  ' },
    { id: 'user-c', name: null },
    { id: 'user-d', name: 'Dani' },
  );
  const entitlements = new EntitlementsService(db as any, { get: jest.fn() } as any);
  const access = new AccessScopeService(db as any, entitlements);
  return { db, state, access };
}

const sub = (ownerUserId: string, overrides: Record<string, unknown> = {}) => ({
  ownerUserId,
  plan: 'SHARED',
  status: 'ACTIVE',
  source: 'ASAAS',
  currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY),
  ...overrides,
});

const member = (state: { memberships: any[] }, ownerUserId: string, memberUserId: string) =>
  state.memberships.push({ id: `m-${memberUserId}`, ownerUserId, memberUserId, joinedAt: NOW, leftAt: null, createdAt: NOW });

describe('buildScopeWhere (fragmento de leitura, contrato 11b secao 3)', () => {
  const view = { groupOwnerId: 'user-a', memberIds: ['user-a', 'user-b'] };

  it('mine e sempre so o proprio userId, mesmo com grupo', () => {
    expect(buildScopeWhere('user-b', view, 'mine')).toEqual({ userId: 'user-b' });
  });

  it('shared pega so os itens do grupo dos outros membros', () => {
    expect(buildScopeWhere('user-b', view, 'shared')).toEqual({
      sharedGroupOwnerId: 'user-a',
      userId: { in: ['user-a'] },
    });
  });

  it('all soma o proprio e o compartilhado', () => {
    expect(buildScopeWhere('user-b', view, 'all')).toEqual({
      OR: [{ userId: 'user-b' }, { sharedGroupOwnerId: 'user-a', userId: { in: ['user-a'] } }],
    });
  });

  it('sem grupo: shared nao pega nada e all vira so o proprio', () => {
    expect(buildScopeWhere('user-d', NO_ACCESS_VIEW, 'shared')).toEqual({ userId: { in: [] } });
    expect(buildScopeWhere('user-d', NO_ACCESS_VIEW, 'all')).toEqual({ userId: 'user-d' });
  });
});

describe('AccessScopeService.resolve (quem le, com membership e plano conferidos na hora)', () => {
  it('usuario FREE nao tem grupo nem membros visiveis', async () => {
    const { access } = build();
    expect(await access.resolve('user-d')).toEqual(NO_ACCESS_VIEW);
  });

  it('pagador com SHARED ativo e sem membros: grupo e ele mesmo', async () => {
    const { access, state } = build();
    state.subs.push(sub('user-a'));
    expect(await access.resolve('user-a')).toEqual({ groupOwnerId: 'user-a', memberIds: ['user-a'] });
  });

  it('membro ativo ve o grupo do pagador e os outros membros ativos', async () => {
    const { access, state } = build();
    state.subs.push(sub('user-a'));
    member(state, 'user-a', 'user-b');
    member(state, 'user-a', 'user-c');
    expect((await access.resolve('user-b')).groupOwnerId).toBe('user-a');
    expect((await access.resolve('user-b')).memberIds.sort()).toEqual(['user-a', 'user-b', 'user-c']);
  });

  it('ex-membro que comprou plano SHARED proprio le o proprio grupo, nunca o antigo (e o antigo nao o lista)', async () => {
    const { access, state } = build();
    state.subs.push(sub('user-a'), sub('user-c'));
    member(state, 'user-a', 'user-c');
    state.memberships[0].leftAt = NOW;
    expect(await access.resolve('user-c')).toEqual({ groupOwnerId: 'user-c', memberIds: ['user-c'] });
    expect(await access.resolve('user-a')).toEqual({ groupOwnerId: 'user-a', memberIds: ['user-a'] });
  });

  it('membro que saiu nao tem acesso ao grupo', async () => {
    const { access, state } = build();
    state.subs.push(sub('user-a'));
    member(state, 'user-a', 'user-b');
    state.memberships[0].leftAt = NOW;
    expect(await access.resolve('user-b')).toEqual(NO_ACCESS_VIEW);
  });

  it('plano do pagador cancelado ha mais que a tolerancia pausa o grupo para o membro', async () => {
    const { access, state } = build();
    state.subs.push(sub('user-a', { status: 'CANCELED', currentPeriodEnd: new Date(NOW.getTime() - DAY) }));
    member(state, 'user-a', 'user-b');
    expect(await access.resolve('user-b')).toEqual(NO_ACCESS_VIEW);
  });

  it('PAST_DUE dentro da tolerancia de 7 dias ainda conta como SHARED ativo', async () => {
    const { access, state } = build();
    state.subs.push(sub('user-a', { status: 'PAST_DUE', currentPeriodEnd: new Date(NOW.getTime() - 2 * DAY) }));
    member(state, 'user-a', 'user-b');
    expect((await access.resolve('user-b')).groupOwnerId).toBe('user-a');
  });

  it('plano proprio INDIVIDUAL do membro nao vira grupo nem esconde o SHARED do pagador', async () => {
    const { access, state } = build();
    state.subs.push(sub('user-a'), { ...sub('user-b'), plan: 'INDIVIDUAL' });
    member(state, 'user-a', 'user-b');
    expect((await access.resolve('user-b')).groupOwnerId).toBe('user-a');
  });

  it('concessao (GRANT) de SHARED vencida nao da acesso', async () => {
    const { access, state } = build();
    state.subs.push(sub('user-a', { source: 'GRANT', status: 'ACTIVE', currentPeriodEnd: new Date(NOW.getTime() - 1) }));
    expect(await access.resolve('user-a')).toEqual(NO_ACCESS_VIEW);
  });
});

describe('AccessScopeService: decisao por item e escrita', () => {
  it('canSeeItem: dono sempre; outro so com item marcado do mesmo grupo e membro ativo', async () => {
    const { access, state } = build();
    state.subs.push(sub('user-a'));
    member(state, 'user-a', 'user-b');
    expect(await access.canSeeItem('user-a', { userId: 'user-a', sharedGroupOwnerId: null })).toBe(true);
    expect(await access.canSeeItem('user-b', { userId: 'user-a', sharedGroupOwnerId: null })).toBe(false);
    expect(await access.canSeeItem('user-b', { userId: 'user-a', sharedGroupOwnerId: 'user-a' })).toBe(true);
    expect(await access.canSeeItem('user-b', { userId: 'user-a', sharedGroupOwnerId: 'user-z' })).toBe(false);
    expect(await access.canSeeItem('user-d', { userId: 'user-a', sharedGroupOwnerId: 'user-a' })).toBe(false);
  });

  it('requireActiveGroupForSharing: sem grupo ativo, 409 com codigo claro', async () => {
    const { access } = build();
    const error = await access.requireActiveGroupForSharing('user-d').then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: SHARING_NEEDS_ACTIVE_GROUP_CODE });
  });

  it('firstNamesById devolve so o primeiro nome (ou nulo quando nao ha)', async () => {
    const { access } = build();
    const names = await access.firstNamesById(['user-a', 'user-b', 'user-c', 'user-a']);
    expect(Object.fromEntries(names)).toEqual({ 'user-a': 'Ana', 'user-b': null, 'user-c': null });
  });
});
