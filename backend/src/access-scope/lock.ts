import { Prisma } from '@prisma/client';

/**
 * Trava a linha do User (FOR NO KEY UPDATE). Ordem unica de escrita que mexe em compartilhamento:
 * 1) linha do AUTOR do item (ou do membro que sai), 2) membership, 3) itens.
 */
export async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
}
