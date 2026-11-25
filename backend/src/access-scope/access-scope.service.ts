import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EntitlementsService } from '../billing/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessView, buildScopeWhere, NO_ACCESS_VIEW, ReadScope, ScopeWhere } from './read-scope';
import { firstNameOf } from './shared-view';

type Db = Prisma.TransactionClient | PrismaService;

export const SHARING_NEEDS_ACTIVE_GROUP_CODE = 'SHARING_NEEDS_ACTIVE_GROUP';

/** Item visto pelo ponto de decisao: so os campos que decidem o acesso. */
export interface SharableItem {
  userId: string;
  sharedGroupOwnerId: string | null;
}

/**
 * UNICO ponto de decisao de acesso a dado compartilhado (contrato 11b, secao 3). Nenhuma consulta
 * de leitura de item pode usar userId solto: as listagens e as escritas de parceiro passam por aqui.
 * Acesso so com membership ativa (ou pagador) E plano efetivo SHARED ativo, conferidos na hora.
 */
@Injectable()
export class AccessScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Quem le: grupo e membros cujos itens podem aparecer. Sem plano SHARED ativo, nada. */
  async resolve(userId: string, db: Db = this.prisma): Promise<AccessView> {
    const plan = await this.entitlements.resolvePlan(userId);
    if (plan !== 'SHARED') return NO_ACCESS_VIEW;

    const membership = await db.groupMembership.findFirst({
      where: { memberUserId: userId, leftAt: null },
      select: { ownerUserId: true },
    });
    const groupOwnerId = membership?.ownerUserId ?? userId;
    const activeMembers = await db.groupMembership.findMany({
      where: { ownerUserId: groupOwnerId, leftAt: null },
      select: { memberUserId: true },
    });
    const candidates = [...new Set([groupOwnerId, ...activeMembers.map((m) => m.memberUserId)])];
    const memberIds = await this.keepUsersWithSharedPlan(userId, candidates);
    return { groupOwnerId, memberIds };
  }

  async scopeWhere(userId: string, scope: ReadScope, db: Db = this.prisma): Promise<ScopeWhere> {
    if (scope === 'mine') return { userId };
    return buildScopeWhere(userId, await this.resolve(userId, db), scope);
  }

  /** Pode ver o item de outro usuario agora? Dono sempre pode; outro so com item compartilhado no grupo. */
  async canSeeItem(readerId: string, item: SharableItem, db: Db = this.prisma): Promise<boolean> {
    if (item.userId === readerId) return true;
    if (item.sharedGroupOwnerId === null) return false;
    const view = await this.resolve(readerId, db);
    return view.groupOwnerId === item.sharedGroupOwnerId && view.memberIds.includes(item.userId);
  }

  /** Grupo ativo onde o usuario pode marcar itens. Sem ele, 409 com codigo claro. */
  async requireActiveGroupForSharing(userId: string, db: Db = this.prisma): Promise<string> {
    const view = await this.resolve(userId, db);
    if (view.groupOwnerId === null) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: SHARING_NEEDS_ACTIVE_GROUP_CODE,
        message: 'Voce precisa de um grupo Compartilhado ativo para compartilhar.',
      });
    }
    return view.groupOwnerId;
  }

  /** Primeiro nome de cada autor, em lote. */
  async firstNamesById(userIds: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, firstNameOf(user.name)]));
  }

  private async keepUsersWithSharedPlan(readerId: string, ids: string[]): Promise<string[]> {
    const checks = await Promise.all(
      ids.map(async (id) => {
        const eligible = id === readerId || (await this.entitlements.resolvePlan(id)) === 'SHARED';
        return eligible ? id : null;
      }),
    );
    return checks.filter((id): id is string => id !== null);
  }
}
