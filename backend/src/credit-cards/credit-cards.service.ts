import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreditLimitChangedError, CreditLimitWriteUncertainError } from '../credit-cycle/conversation-write.types';
import { CreditCycleService } from '../credit-cycle/credit-cycle.service';
import { lockUserForCredit } from '../credit-cycle/credit-cycle.util';
import { SetCreditCycleCeilingDto } from '../credit-cycle/dto/set-credit-cycle-ceiling.dto';
import { AccessScopeService } from '../access-scope/access-scope.service';
import { isRecordNotFound } from '../access-scope/lock';
import { ReadScope } from '../access-scope/read-scope';
import {
  partnerSharingFlags,
  ownSharingFlags,
  SharingReceipt,
  toSharingReceipt,
} from '../access-scope/shared-view';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreditCardDto } from './dto/create-credit-card.dto';
import { UpdateCreditCardDto } from './dto/update-credit-card.dto';

/**
 * Teto tecnico contra abuso (contrato item 9, secao 4.6). NAO e limite de plano:
 * o limite por plano vem depois do billing, via EntitlementsService.
 */
export const MAX_ACTIVE_CARDS_PER_USER = 10;

const CARD_SELECT = {
  id: true,
  userId: true,
  name: true,
  closingDay: true,
  dueDay: true,
  countAllPayments: true,
  isDefault: true,
  archivedAt: true,
  sharedGroupOwnerId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CreditCardSelect;

type CardRow = Prisma.CreditCardGetPayload<{ select: typeof CARD_SELECT }>;

/** Recibo do que foi persistido (sem agregacao posterior). */
export interface CreditCardReceipt {
  id: string;
  name: string;
  closingDay: number;
  dueDay: number | null;
  countAllPayments: boolean;
  isDefault: boolean;
}

type Db = Prisma.TransactionClient;

/** Resultado desconhecido: o commit pode ter ocorrido. Nao repetir; conferir a tela. */
export class CreditCardWriteUncertainError extends InternalServerErrorException {
  constructor() {
    super('Resultado da alteracao do cartao desconhecido. Confira a tela antes de tentar de novo.');
  }
}

function normalizeCardName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > 40) {
    throw new BadRequestException('O nome do cartao deve ter de 1 a 40 caracteres.');
  }
  return name;
}

function toReceipt(card: CardRow): CreditCardReceipt {
  return {
    id: card.id,
    name: card.name,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    countAllPayments: card.countAllPayments,
    isDefault: card.isDefault,
  };
}

/** Cartao proprio na lista: flags de compartilhamento (contrato 11b, shared-view). userId jamais sai. */
function toCardView(card: CardRow) {
  return {
    ...toReceipt(card),
    ...ownSharingFlags(card),
    archivedAt: card.archivedAt ? card.archivedAt.toISOString() : null,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

/** Cartao do parceiro (escopo shared/all): nunca arquivado, primeiro nome de quem o compartilhou. */
function toPartnerCardView(card: CardRow, sharedByName: string | null) {
  return {
    ...toReceipt(card),
    ...partnerSharingFlags(sharedByName),
    archivedAt: card.archivedAt ? card.archivedAt.toISOString() : null,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

@Injectable()
export class CreditCardsService {
  private readonly logger = new Logger(CreditCardsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly creditCycle: CreditCycleService,
    private readonly entitlements: EntitlementsService,
    private readonly access: AccessScopeService,
  ) {}

  /**
   * Ativos por padrao; includeArchived traz o historico (so do proprio — cartao
   * arquivado nunca aparece no escopo compartilhado, 11b-1b D3).
   * scope: mine (padrao), shared (so os cartoes marcados do parceiro), all (os dois).
   */
  async list(userId: string, includeArchived: boolean, scope: ReadScope = 'mine') {
    const view = scope === 'mine' ? null : await this.access.resolve(userId);
    const partnerIds = view ? view.memberIds.filter((id) => id !== userId) : [];
    const partnerWhere: Prisma.CreditCardWhereInput | null =
      view?.groupOwnerId && partnerIds.length > 0
        ? { sharedGroupOwnerId: view.groupOwnerId, userId: { in: partnerIds }, archivedAt: null }
        : null;

    if (scope === 'shared' && !partnerWhere) return [];

    const ownWhere: Prisma.CreditCardWhereInput = {
      userId,
      ...(includeArchived ? {} : { archivedAt: null }),
    };
    const cards = await this.prisma.creditCard.findMany({
      where: scope === 'shared' ? partnerWhere! : scope === 'all' && partnerWhere ? { OR: [ownWhere, partnerWhere] } : ownWhere,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: CARD_SELECT,
    });
    if (scope === 'mine' || cards.every((card) => card.userId === userId)) {
      return cards.map(toCardView);
    }
    const names = await this.access.firstNamesById(
      cards.filter((card) => card.userId !== userId).map((card) => card.userId),
    );
    return cards.map((card) =>
      card.userId === userId ? toCardView(card) : toPartnerCardView(card, names.get(card.userId) ?? null),
    );
  }

  async get(userId: string, id: string) {
    return toCardView(await this.findOwned(this.prisma, userId, id));
  }

  async create(userId: string, dto: CreateCreditCardDto) {
    const name = normalizeCardName(dto.name);
    if (dto.countAllPayments === true) {
      throw new BadRequestException('So o cartao padrao pode somar todos os pagamentos.');
    }
    // Limite por plano (contrato 11, D7): FREE 1, Individual 5, Compartilhado 10.
    await this.entitlements.assertCanCreate(userId, 'creditCards');
    return this.write(userId, async (tx) => {
      const active = await tx.creditCard.count({ where: { userId, archivedAt: null } });
      if (active >= MAX_ACTIVE_CARDS_PER_USER) {
        throw new UnprocessableEntityException(
          `Voce ja tem ${MAX_ACTIVE_CARDS_PER_USER} cartoes ativos (limite tecnico).`,
        );
      }
      await this.assertNameFree(tx, userId, name);
      const card = await tx.creditCard.create({
        data: {
          userId,
          name,
          closingDay: dto.closingDay,
          dueDay: dto.dueDay ?? null,
          countAllPayments: false,
          isDefault: false,
        },
        select: CARD_SELECT,
      });
      return toReceipt(card);
    });
  }

  async update(userId: string, id: string, dto: UpdateCreditCardDto) {
    const name = dto.name === undefined ? undefined : normalizeCardName(dto.name);
    return this.write(userId, async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      if (current.archivedAt) throw new ConflictException('Cartao arquivado nao pode ser alterado.');
      if (dto.countAllPayments === true && !current.isDefault) {
        throw new BadRequestException('So o cartao padrao pode somar todos os pagamentos.');
      }
      if (name !== undefined) await this.assertNameFree(tx, userId, name, id);
      const updated = await tx.creditCard.update({
        where: { id },
        data: {
          name,
          closingDay: dto.closingDay,
          dueDay: dto.dueDay,
          countAllPayments: dto.countAllPayments,
        },
        select: CARD_SELECT,
      });
      return toReceipt(updated);
    });
  }

  /** Arquiva (nao apaga). O padrao nao se arquiva: promova outro antes. */
  async archive(userId: string, id: string) {
    return this.write(userId, async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      if (current.isDefault) {
        throw new ConflictException('Promova outro cartao antes de arquivar o padrao.');
      }
      if (current.archivedAt) {
        return { ...toReceipt(current), archivedAt: current.archivedAt.toISOString() };
      }
      const updated = await tx.creditCard.update({
        where: { id },
        data: { archivedAt: new Date() },
        select: CARD_SELECT,
      });
      return { ...toReceipt(updated), archivedAt: updated.archivedAt?.toISOString() ?? null };
    });
  }

  async makeDefault(userId: string, id: string) {
    return this.write(userId, async (tx) => {
      const target = await this.findOwned(tx, userId, id);
      if (target.archivedAt) throw new ConflictException('Cartao arquivado nao pode ser o padrao.');
      if (target.isDefault) return toReceipt(target);
      // Antes de promover: o antigo padrao sai (indice parcial aceita um so por vez).
      await tx.creditCard.updateMany({
        where: { userId, isDefault: true, archivedAt: null },
        data: { isDefault: false, countAllPayments: false },
      });
      const updated = await tx.creditCard.update({
        where: { id },
        data: { isDefault: true },
        select: CARD_SELECT,
      });
      return toReceipt(updated);
    });
  }

  /**
   * Marca/desmarca o cartao para o grupo (11b-1b, D2). So o autor; lock na linha do autor
   * antes de conferir o grupo (ordem da casa: autor -> membership -> itens). Desmarcar o
   * cartao desmarca tambem os lancamentos de outro membro que apontavam para ele: eles so
   * eram visiveis por causa do cartao (privacidade primeiro).
   */
  async setSharing(userId: string, id: string, shared: boolean): Promise<SharingReceipt> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockUserForCredit(tx, userId);
        const card = await tx.creditCard.findFirst({
          where: { id, userId },
          select: { id: true, sharedGroupOwnerId: true, archivedAt: true, updatedAt: true },
        });
        if (!card) throw new NotFoundException('Cartao nao encontrado.');
        if (shared && card.archivedAt) {
          throw new ConflictException('Cartao arquivado nao pode ser compartilhado.');
        }
        const groupOwnerId = shared ? await this.access.requireActiveGroupForSharing(userId, tx) : null;
        if (card.sharedGroupOwnerId === groupOwnerId) {
          return toSharingReceipt(card);
        }
        const updated = await tx.creditCard.update({
          where: { id },
          data: { sharedGroupOwnerId: groupOwnerId },
          select: { id: true, sharedGroupOwnerId: true, updatedAt: true },
        });
        if (!shared && card.sharedGroupOwnerId) {
          await tx.transaction.updateMany({
            where: { cardId: id, userId: { not: userId }, sharedGroupOwnerId: card.sharedGroupOwnerId },
            data: { sharedGroupOwnerId: null },
          });
        }
        return toSharingReceipt(updated);
      });
    } catch (error) {
      throw isRecordNotFound(error) ? new NotFoundException('Cartao nao encontrado.') : error;
    }
  }

  /** Ciclo aberto do cartao (mesma forma de /credit-cycle/current). Cartao alheio: 404. */
  async cycle(userId: string, id: string) {
    return this.creditCycle.getCycleForCard(userId, id);
  }

  async setCeiling(userId: string, id: string, dto: SetCreditCycleCeilingDto) {
    const receipt = await this.creditCycle.setCeilingForCard(userId, id, dto);
    return { cardId: id, ...receipt };
  }

  /** Limpa o teto do ciclo aberto do cartao. Sem teto vigente: 409. Recibo do que foi removido. */
  async clearCeiling(userId: string, id: string) {
    try {
      const receipt = await this.creditCycle.clearCeilingForCard(userId, id);
      return { cardId: id, ...receipt };
    } catch (error) {
      throw this.mapCeilingClearError(error);
    }
  }

  private mapCeilingClearError(error: unknown): unknown {
    if (error instanceof CreditLimitChangedError) {
      return new ConflictException('Nao ha teto neste ciclo para limpar. Atualize a tela.');
    }
    if (error instanceof CreditLimitWriteUncertainError) return new CreditCardWriteUncertainError();
    return error;
  }

  /**
   * Escrita comum: bloqueia a linha do User, roda a escrita e devolve o recibo.
   * Falha antes do commit: erro comprovado. Falha no commit depois do callback:
   * resultado desconhecido (sem repetir). Falha em touchUserData: so refreshPending.
   */
  private async write<T extends CreditCardReceipt>(
    userId: string,
    fn: (tx: Db) => Promise<T>,
  ): Promise<T & { refreshPending: boolean }> {
    let callbackFinished = false;
    let receipt: T;
    try {
      receipt = await this.prisma.$transaction(async (tx) => {
        await lockUserForCredit(tx, userId);
        const result = await fn(tx);
        callbackFinished = true;
        return result;
      });
    } catch (error) {
      if (callbackFinished) throw new CreditCardWriteUncertainError();
      throw this.mapWriteError(error);
    }
    return { ...receipt, refreshPending: await this.refreshAfterWrite(userId) };
  }

  private mapWriteError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Ja existe um cartao com este nome.');
    }
    return error;
  }

  private async refreshAfterWrite(userId: string): Promise<boolean> {
    try {
      await this.lifeEngineService.touchUserData(userId);
      return false;
    } catch (error) {
      this.logger.warn({ operation: 'creditCards.refresh', errorName: error instanceof Error ? error.name : 'Unknown' });
      return true;
    }
  }

  /** Nome unico entre ativos, sem diferenciar maiuscula. Chamado sob o lock do User. */
  private async assertNameFree(tx: Db, userId: string, name: string, exceptId?: string) {
    // Nao usar `mode: 'insensitive'`: o Prisma traduz para ILIKE e "%" ou "_" no nome viram curinga
    // (falso 409). Sao no maximo MAX_ACTIVE_CARDS_PER_USER linhas; o indice unico parcial
    // (lower(name)) continua sendo a garantia final contra corrida.
    const active = await tx.creditCard.findMany({
      where: { userId, archivedAt: null },
      select: { id: true, name: true },
    });
    const wanted = name.toLowerCase();
    const clash = active.some((card) => card.id !== exceptId && card.name.toLowerCase() === wanted);
    if (clash) throw new ConflictException('Ja existe um cartao com este nome.');
  }

  /** Cartao do usuario ou 404 (nunca 403). */
  private async findOwned(db: Db, userId: string, id: string): Promise<CardRow> {
    const card = await db.creditCard.findFirst({ where: { id, userId }, select: CARD_SELECT });
    if (!card) throw new NotFoundException('Cartao nao encontrado.');
    return card;
  }
}
