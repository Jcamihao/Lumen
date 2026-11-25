import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceCategory, Prisma, TransactionType } from '@prisma/client';
import { AccessScopeService } from '../access-scope/access-scope.service';
import { isRecordNotFound, lockUserRow } from '../access-scope/lock';
import { ReadScope } from '../access-scope/read-scope';
import {
  isSharedItem,
  ownSharingFlags,
  partnerSharingFlags,
  SharingReceipt,
  toSharingReceipt,
  withoutSharingMark,
} from '../access-scope/shared-view';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinanceCategoryDto } from './dto/create-finance-category.dto';
import { UpdateFinanceCategoryDto } from './dto/update-finance-category.dto';

const BUDGET_ONLY_FOR_EXPENSE =
  'Orcamento mensal so vale para categorias de despesa.';

const PARTNER_CATEGORY_EDIT_MESSAGE = 'Quem nao criou a categoria so altera nome e cor.';

/** Decimal do Prisma serializa como string no JSON; o front espera numero. Sem a marca interna de compartilhamento. */
export function toCategoryResponse(category: FinanceCategory) {
  return {
    ...withoutSharingMark(category),
    monthlyBudget:
      category.monthlyBudget === null || category.monthlyBudget === undefined
        ? null
        : Number(category.monthlyBudget),
  };
}

/** Categoria na exportacao LGPD (contrato 11b, item 7): traz shared por item e nunca a marca interna. */
export function toPrivacyCategoryExport(category: FinanceCategory) {
  return { ...toCategoryResponse(category), shared: isSharedItem(category) };
}

/** Categoria que o parceiro pode ver: so nome, cor e icone (sem orcamento nem id do autor). */
function toPartnerCategoryView(category: FinanceCategory, authorFirstName: string | null) {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    icon: category.icon,
    type: category.type,
    ...partnerSharingFlags(authorFirstName),
  };
}

@Injectable()
export class FinanceCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly access: AccessScopeService,
  ) {}

  async list(userId: string, scope: ReadScope = 'mine') {
    const categories = await this.prisma.financeCategory.findMany({
      where: await this.access.scopeWhere(userId, scope),
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    if (scope === 'mine') {
      return categories.map(toCategoryResponse);
    }

    const names = await this.access.firstNamesById(
      categories.filter((c) => c.userId !== userId).map((c) => c.userId),
    );
    return categories.map((category) =>
      category.userId === userId
        ? { ...toCategoryResponse(category), ...ownSharingFlags(category) }
        : toPartnerCategoryView(category, names.get(category.userId) ?? null),
    );
  }

  async create(userId: string, dto: CreateFinanceCategoryDto) {
    if (typeof dto.monthlyBudget === 'number' && dto.type !== TransactionType.EXPENSE) {
      throw new BadRequestException(BUDGET_ONLY_FOR_EXPENSE);
    }

    const category = await this.prisma.financeCategory
      .create({
        data: {
          userId,
          name: dto.name,
          color: dto.color,
          icon: dto.icon,
          type: dto.type,
          monthlyBudget: dto.monthlyBudget ?? null,
        },
      })
      .catch((error) => {
        throw this.friendlyDuplicateNameError(error);
      });

    if (dto.monthlyBudget !== undefined) {
      await this.lifeEngineService.touchUserData(userId);
    }

    return toCategoryResponse(category);
  }

  async update(userId: string, id: string, dto: UpdateFinanceCategoryDto) {
    const reachable = await this.findReachable(userId, id);
    if (reachable.userId !== userId) {
      return this.updateAsPartner(userId, reachable.userId, id, dto);
    }
    const existing = reachable;
    const data: UpdateFinanceCategoryDto = { ...dto };

    if ((dto.type ?? existing.type) !== TransactionType.EXPENSE) {
      if (typeof dto.monthlyBudget === 'number') {
        throw new BadRequestException(BUDGET_ONLY_FOR_EXPENSE);
      }
      // Categoria que deixa de ser despesa nao pode ficar com teto orfao.
      if (existing.monthlyBudget !== null) {
        data.monthlyBudget = null;
      }
    }

    const category = await this.prisma.financeCategory
      .update({
        where: { id },
        data,
      })
      .catch((error) => {
        throw this.friendlyDuplicateNameError(error);
      });

    // Orcamento novo/alterado/removido muda os alertas: recalcula os insights
    // agora em vez de esperar o proximo ciclo.
    if (data.monthlyBudget !== undefined) {
      await this.lifeEngineService.touchUserData(userId);
    }

    return toCategoryResponse(category);
  }

  async remove(userId: string, id: string) {
    const reachable = await this.findReachable(userId, id);
    if (reachable.userId !== userId) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'PARTNER_EDIT_RESTRICTED',
        message: 'Somente quem criou a categoria pode exclui-la.',
      });
    }
    // Sai de todo lancamento que a usa, o do autor e o dos parceiros em categoria compartilhada.
    await this.prisma.transaction.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    });
    await this.prisma.financeCategory
      .delete({
        where: { id },
      })
      .catch((error) => {
        throw this.friendlyDuplicateNameError(error);
      });

    return { success: true };
  }

  /**
   * Marca ou desmarca a categoria como compartilhada (contrato 11b, item 3). So o autor; marcar exige grupo
   * ativo (409 com codigo). Idempotente. Trava o User do autor primeiro (ordem unica, item 6).
   */
  async setSharing(userId: string, id: string, shared: boolean): Promise<SharingReceipt> {
    return this.markSharing(userId, id, shared).catch((error) => {
      throw this.friendlyDuplicateNameError(error);
    });
  }

  private async markSharing(userId: string, id: string, shared: boolean): Promise<SharingReceipt> {
    return this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, userId);
      const category = await tx.financeCategory.findFirst({
        where: { id, userId },
        select: { id: true, sharedGroupOwnerId: true, updatedAt: true },
      });
      if (!category) {
        throw new NotFoundException('Categoria financeira nao encontrada.');
      }

      const groupOwnerId = shared ? await this.access.requireActiveGroupForSharing(userId, tx) : null;
      if (category.sharedGroupOwnerId === groupOwnerId) {
        return toSharingReceipt(category);
      }
      const updated = await tx.financeCategory.update({
        where: { id },
        data: { sharedGroupOwnerId: groupOwnerId },
        select: { id: true, sharedGroupOwnerId: true, updatedAt: true },
      });
      return toSharingReceipt(updated);
    });
  }

  /** Edicao por quem nao criou: so nome e cor, e so de categoria compartilhada que ele ve (contrato 11b, item 4). */
  private async updateAsPartner(
    readerId: string,
    authorId: string,
    id: string,
    dto: UpdateFinanceCategoryDto,
  ) {
    if (dto.type !== undefined || dto.icon !== undefined || dto.monthlyBudget !== undefined) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'PARTNER_EDIT_RESTRICTED',
        message: PARTNER_CATEGORY_EDIT_MESSAGE,
      });
    }
    const category = await this.prisma
      .$transaction(async (tx) => {
        await lockUserRow(tx, authorId);
        await this.lockReachable(tx, readerId, id);
        return tx.financeCategory.update({
          where: { id },
          data: { name: dto.name, color: dto.color },
        });
      })
      .catch((error) => {
        throw this.friendlyDuplicateNameError(error);
      });

    const names = await this.access.firstNamesById([authorId]);
    return toPartnerCategoryView(category, names.get(authorId) ?? null);
  }

  private async lockReachable(tx: Prisma.TransactionClient, readerId: string, id: string) {
    const rows = await tx.$queryRaw<FinanceCategory[]>`
      SELECT * FROM "FinanceCategory" WHERE "id" = ${id} FOR NO KEY UPDATE`;
    const row = rows[0];
    if (!row || !(await this.access.canSeeItem(readerId, row, tx))) {
      throw new NotFoundException('Categoria financeira nao encontrada.');
    }
    return row;
  }

  /** Indice unico (userId, name, type): mensagem legivel em vez do 500 cru do Prisma. */
  private friendlyDuplicateNameError(error: unknown) {
    if ((error as { code?: string } | null)?.code === 'P2002') {
      return new BadRequestException('Você já tem uma categoria com este nome.');
    }
    if (isRecordNotFound(error)) {
      return new NotFoundException('Categoria financeira nao encontrada.');
    }

    return error;
  }

  /** Categoria do proprio usuario ou compartilhada que ele ve; alheia e inexistente dao o mesmo 404. */
  private async findReachable(userId: string, id: string) {
    const category = await this.prisma.financeCategory.findFirst({
      where: { id, OR: [{ userId }, { sharedGroupOwnerId: { not: null } }] },
    });
    if (!category || !(await this.access.canSeeItem(userId, category))) {
      throw new NotFoundException('Categoria financeira nao encontrada.');
    }

    return category;
  }
}
