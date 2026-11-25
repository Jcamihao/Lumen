export const READ_SCOPES = ['mine', 'shared', 'all'] as const;

export type ReadScope = (typeof READ_SCOPES)[number];

/**
 * Visao de quem le: grupo do qual ele e pagador ou membro ativo, e os usuarios
 * cujo item compartilhado pode aparecer (com plano SHARED ativo). Sem grupo: groupOwnerId nulo.
 */
export interface AccessView {
  groupOwnerId: string | null;
  memberIds: string[];
}

export const NO_ACCESS_VIEW: AccessView = { groupOwnerId: null, memberIds: [] };

/** Fragmento de where que vale para Transaction e FinanceCategory (mesmos campos userId/sharedGroupOwnerId). */
export type ScopeWhere =
  | { userId: string | { in: string[] } }
  | { sharedGroupOwnerId: string; userId: { in: string[] } }
  | {
      OR: Array<
        | { userId: string }
        | { sharedGroupOwnerId: string; userId: { in: string[] } }
      >;
    };

const NOTHING: ScopeWhere = { userId: { in: [] } };

/**
 * Monta o where de leitura. "mine" e sempre so o proprio userId. "shared" pega os itens
 * marcados pelos outros membros; sem grupo ativo nao pega nada. "all" soma os dois.
 */
export function buildScopeWhere(readerId: string, view: AccessView, scope: ReadScope): ScopeWhere {
  const mine: ScopeWhere = { userId: readerId };
  if (scope === 'mine') return mine;
  if (view.groupOwnerId === null) return scope === 'shared' ? NOTHING : mine;

  const partnerIds = view.memberIds.filter((id) => id !== readerId);
  const shared = { sharedGroupOwnerId: view.groupOwnerId, userId: { in: partnerIds } };
  if (scope === 'shared') return shared;
  return { OR: [{ userId: readerId }, shared] };
}
