import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { lockUserForCredit } from '../credit-cycle/credit-cycle.util';
import { PrismaService } from '../prisma/prisma.service';

/*
 * Vinculo de lancamento, parcelado e conta fixa com um cartao (contrato item 9, secoes 4.1 e 4.5).
 *
 * Ordem unica de locks em escrita que mexe em cartao:
 *   1) linha do User (FOR NO KEY UPDATE), 2) cartao, 3) lancamento / parcela / conta fixa.
 * Criar, arquivar e promover cartao tambem travam o User primeiro, entao a checagem de
 * "arquivado" feita aqui, sob o lock, nao tem corrida. O lock so e pego quando ha cardId
 * (escrita sem cartao nao paga esse custo).
 */

export const CARD_NOT_FOUND_MESSAGE = 'Cartao nao encontrado.';
export const CARD_NEEDS_CREDIT_MESSAGE = 'Cartao so pode ser usado com pagamento em credito.';
export const CARD_ARCHIVED_MESSAGE = 'Cartao arquivado nao aceita novo lancamento.';

type Db = Prisma.TransactionClient;

/** Cartao do proprio usuario ou 404 (mesma mensagem para alheio e inexistente). */
export async function findOwnedCardForLink(db: Db, userId: string, cardId: string) {
  const card = await db.creditCard.findFirst({
    where: { id: cardId, userId },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!card) throw new NotFoundException(CARD_NOT_FOUND_MESSAGE);
  return card;
}

/** Pega o lock do User quando a escrita traz cardId. Chamar antes de qualquer leitura de cartao. */
export async function lockForCardLink(db: Db, userId: string, cardId: unknown): Promise<void> {
  if (typeof cardId === 'string') await lockUserForCredit(db, userId);
}

/** Criacao: cardId ausente ou nulo = sem vinculo explicito (conta no cartao padrao). */
export async function resolveCardForCreate(
  db: Db,
  userId: string,
  cardId: string | null | undefined,
  paymentMethod: PaymentMethod | null | undefined,
): Promise<string | undefined> {
  if (typeof cardId !== 'string') return undefined;
  if (paymentMethod !== PaymentMethod.CREDIT) throw new BadRequestException(CARD_NEEDS_CREDIT_MESSAGE);
  const card = await findOwnedCardForLink(db, userId, cardId);
  if (card.archivedAt) throw new BadRequestException(CARD_ARCHIVED_MESSAGE);
  return card.id;
}

/**
 * Edicao: devolve so o que deve ser gravado (undefined = nao mexe, null = limpa).
 * - Saiu de CREDIT: cardId vai para null (o historico continua com o cardId antigo no
 *   proprio lancamento, mas aqui o vinculo some).
 * - Cartao ja gravado que depois foi arquivado continua valido: so bloqueia vinculo NOVO.
 */
export async function resolveCardForUpdate(
  db: Db,
  userId: string,
  current: { cardId?: string | null; paymentMethod?: PaymentMethod | null },
  dto: { cardId?: string | null; paymentMethod?: PaymentMethod | null },
): Promise<{ cardId?: string | null }> {
  const effective = dto.paymentMethod !== undefined ? dto.paymentMethod : current.paymentMethod;
  if (typeof dto.cardId === 'string' && effective !== PaymentMethod.CREDIT) {
    throw new BadRequestException(CARD_NEEDS_CREDIT_MESSAGE);
  }
  if (effective !== PaymentMethod.CREDIT) return current.cardId ? { cardId: null } : {};
  if (dto.cardId === undefined) return {};
  if (dto.cardId === null) return { cardId: null };
  if (dto.cardId === current.cardId) return {};
  const card = await findOwnedCardForLink(db, userId, dto.cardId);
  if (card.archivedAt) throw new BadRequestException(CARD_ARCHIVED_MESSAGE);
  return { cardId: card.id };
}

/**
 * Escrita que mexe em cartao ou forma de pagamento roda em transacao com o lock do User.
 * Trocar a forma de pagamento tambem precisa do lock: sem ele, um PATCH para PIX pode
 * deixar um cardId que outro PATCH acabou de gravar (corrida, revisao sonnet 9a-2).
 */
export async function withCardGuard<T>(
  prisma: PrismaService,
  userId: string,
  needsLock: boolean,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  if (!needsLock) return fn(prisma);
  return prisma.$transaction(async (tx) => {
    await lockUserForCredit(tx, userId);
    return fn(tx);
  });
}
