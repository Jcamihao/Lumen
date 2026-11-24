import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { subscriptionGrantsAccess } from './access.util';
import { CreateGroupInviteDto } from './dto/create-group-invite.dto';
import { getPlan } from './plans.catalog';

/** Validade do convite (contrato 11, D4). */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Máximo de convites pendentes por grupo (contrato 11, D4). */
const MAX_PENDING_INVITES = 10;

/** Mensagem única do convite inválido (D12: expirado/revogado/consumido/alheio = 404 igual). */
const INVALID_INVITE_MESSAGE = 'Este convite de grupo é inválido ou expirou.';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function firstNameOf(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export interface GroupMemberView {
  id: string;
  email: string;
  name: string | null;
  joinedAt: string;
}

export interface GroupInviteView {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}

export type GroupView =
  | {
      role: 'owner';
      planActive: boolean;
      seats: number;
      members: GroupMemberView[];
      invites: GroupInviteView[];
    }
  | {
      role: 'member';
      ownerFirstName: string | null;
      joinedAt: string;
    };

export interface CreatedInviteView extends GroupInviteView {
  /** Token em claro: SO nesta resposta (no banco vive apenas o hash — D4). */
  token: string;
}

/**
 * Grupo do plano Compartilhado (contrato 11, 11a). Servico UNICO de acesso a
 * GroupMembership/GroupInvite (D12): todo `userId` vem do token; em 11a nada de
 * dado e compartilhado — a associacao so muda o plano efetivo (D6).
 */
@Injectable()
export class GroupService {
  constructor(private readonly prisma: PrismaService) {}

  async getGroup(userId: string): Promise<GroupView> {
    const now = new Date();
    const membership = await this.prisma.groupMembership.findFirst({
      where: { memberUserId: userId, leftAt: null },
      include: { owner: { select: { name: true } } },
    });
    if (membership) {
      // Membro ve so o primeiro nome do pagador e a data que entrou (D10) — nada sobre
      // cobranca ou outros membros passa por aqui.
      return {
        role: 'member',
        ownerFirstName: firstNameOf(membership.owner.name),
        joinedAt: membership.joinedAt.toISOString(),
      };
    }
    return this.getOwnerView(userId, now);
  }

  private async getOwnerView(userId: string, now: Date): Promise<GroupView> {
    const [members, invites, ownerSubs] = await Promise.all([
      this.prisma.groupMembership.findMany({
        where: { ownerUserId: userId, leftAt: null },
        include: { member: { select: { email: true, name: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.groupInvite.findMany({
        where: {
          ownerUserId: userId,
          revokedAt: null,
          acceptedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.subscription.findMany({
        where: { ownerUserId: userId, plan: 'SHARED' },
      }),
    ]);
    const ownedAny = members.length > 0 || invites.length > 0;
    const planActive = ownerSubs.some((s) => subscriptionGrantsAccess(s, now));
    if (!ownedAny && !planActive) {
      throw new NotFoundException('Voce nao faz parte de nenhum grupo.');
    }
    return {
      role: 'owner',
      planActive,
      seats: getPlan('SHARED').seats,
      members: members.map((m) => ({
        id: m.id,
        email: m.member.email,
        name: m.member.name,
        joinedAt: m.joinedAt.toISOString(),
      })),
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
      })),
    };
  }

  /**
   * Trava das acoes de pagador (D12): membro chamado aqui ouve 403; quem nao e
   * pagador com SHARED ativo (pelo subscriptionGrantsAccess, D11) tambem ouve 403.
   */
  private async assertPayer(userId: string, now: Date): Promise<void> {
    const memberOf = await this.prisma.groupMembership.findFirst({
      where: { memberUserId: userId, leftAt: null },
      select: { id: true },
    });
    if (memberOf) {
      throw new ForbiddenException(
        'Somente o pagador do grupo gerencia membros e convites.',
      );
    }
    const subs = await this.prisma.subscription.findMany({
      where: { ownerUserId: userId, plan: 'SHARED' },
    });
    if (!subs.some((s) => subscriptionGrantsAccess(s, now))) {
      throw new ForbiddenException(
        'Somente o pagador de um plano Compartilhado ativo gerencia o grupo.',
      );
    }
  }

  async createInvite(
    userId: string,
    dto: CreateGroupInviteDto,
  ): Promise<CreatedInviteView> {
    const now = new Date();
    await this.assertPayer(userId, now);
    const email = dto.email.trim().toLowerCase();

    const pending = await this.prisma.groupInvite.count({
      where: {
        ownerUserId: userId,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (pending >= MAX_PENDING_INVITES) {
      throw new ConflictException(
        `Voce ja tem ${MAX_PENDING_INVITES} convites pendentes. Revogue algum antes de criar outro.`,
      );
    }

    const token = randomBytes(32).toString('base64url');
    const invite = await this.prisma.groupInvite.create({
      data: {
        ownerUserId: userId,
        email,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      },
    });
    return {
      id: invite.id,
      email: invite.email,
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      token,
    };
  }

  async revokeInvite(userId: string, inviteId: string): Promise<void> {
    const now = new Date();
    await this.assertPayer(userId, now);
    const updated = await this.prisma.groupInvite.updateMany({
      where: { id: inviteId, ownerUserId: userId, revokedAt: null, acceptedAt: null },
      data: { revokedAt: now },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Convite nao encontrado (ou ja usado/revogado).');
    }
  }

  /**
   * Aceite (D4/D5): logado com o MESMO e-mail do convite; pagador nao entra (409);
   * entrar sai do grupo anterior (membro); lugar vago e plano do pagador vivo sao
   * reconfirmados dentro da transacao com a linha do pagador travada.
   */
  async acceptInvite(userId: string, token: string): Promise<GroupView> {
    const now = new Date();
    const invite = await this.prisma.groupInvite.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (
      !invite ||
      invite.revokedAt !== null ||
      invite.acceptedAt !== null ||
      invite.expiresAt.getTime() <= now.getTime()
    ) {
      throw new NotFoundException(INVALID_INVITE_MESSAGE);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user || user.email.toLowerCase() !== invite.email) {
      // Nao revela que o convite existe e e de outra pessoa (D12).
      throw new NotFoundException(INVALID_INVITE_MESSAGE);
    }

    // Pagador nao pode ser membro (D5): assinatura propria ativa OU grupo proprio ativo.
    const ownSubs = await this.prisma.subscription.findMany({
      where: { ownerUserId: userId },
    });
    if (ownSubs.some((s) => subscriptionGrantsAccess(s, now))) {
      throw new ConflictException(
        'Voce tem um plano pago ativo e nao pode entrar no grupo de outra pessoa.',
      );
    }
    const ownsGroup = await this.prisma.groupMembership.count({
      where: { ownerUserId: userId, leftAt: null },
    });
    if (ownsGroup > 0) {
      throw new ConflictException(
        'Voce paga um grupo ativo. Desfaça o seu grupo antes de entrar em outro.',
      );
    }

    const seats = getPlan('SHARED').seats;
    try {
      await this.prisma.$transaction(async (tx) => {
        // Serializa aceites do mesmo grupo (a busca de lugares + saida do grupo anterior).
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${invite.ownerUserId} FOR NO KEY UPDATE`;

        const ownerSubs = await tx.subscription.findMany({
          where: { ownerUserId: invite.ownerUserId, plan: 'SHARED' },
        });
        if (!ownerSubs.some((s) => subscriptionGrantsAccess(s, new Date()))) {
          throw new ConflictException('O plano deste grupo nao esta ativo.');
        }
        const activeMembers = await tx.groupMembership.count({
          where: { ownerUserId: invite.ownerUserId, leftAt: null },
        });
        if (activeMembers >= seats - 1) {
          throw new ConflictException('Este grupo ja esta com todos os lugares ocupados.');
        }

        // Sai do grupo anterior se era membro (D5); nunca de grupo proprio (ja barrado acima).
        await tx.groupMembership.updateMany({
          where: { memberUserId: userId, leftAt: null },
          data: { leftAt: new Date() },
        });
        await tx.groupMembership.create({
          data: { ownerUserId: invite.ownerUserId, memberUserId: userId },
        });
        // Consome o convite (corrida: quem marcar primeiro ganha; o outro ouve invalido).
        const consumed = await tx.groupInvite.updateMany({
          where: { id: invite.id, revokedAt: null, acceptedAt: null },
          data: { acceptedAt: new Date(), acceptedUserId: userId },
        });
        if (consumed.count === 0) {
          throw new NotFoundException(INVALID_INVITE_MESSAGE);
        }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Unico parcial de membro ativo: corrida de aceite em dois grupos.
        throw new ConflictException('Voce ja entrou em um grupo agora. Recarregue o plano.');
      }
      throw error;
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: invite.ownerUserId },
      select: { name: true },
    });
    const membership = await this.prisma.groupMembership.findFirst({
      where: { memberUserId: userId, leftAt: null },
      select: { joinedAt: true },
    });
    return {
      role: 'member',
      ownerFirstName: firstNameOf(owner?.name ?? null),
      joinedAt: membership?.joinedAt.toISOString() ?? new Date().toISOString(),
    };
  }

  /** Membro sai sozinho (D3), em duas etapas na UI; aqui so grava o leftAt. */
  async leave(userId: string): Promise<void> {
    const updated = await this.prisma.groupMembership.updateMany({
      where: { memberUserId: userId, leftAt: null },
      data: { leftAt: new Date() },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Voce nao faz parte de nenhum grupo.');
    }
  }

  async removeMember(userId: string, membershipId: string): Promise<void> {
    const now = new Date();
    await this.assertPayer(userId, now);
    const updated = await this.prisma.groupMembership.updateMany({
      where: { id: membershipId, ownerUserId: userId, leftAt: null },
      data: { leftAt: now },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Membro nao encontrado neste grupo.');
    }
  }
}
