import { Prisma } from '@prisma/client';

/**
 * Trava a linha do User (FOR NO KEY UPDATE). Ordem unica de escrita que mexe em compartilhamento:
 * 1) linha do AUTOR do item (ou do membro que sai), 2) membership, 3) itens.
 */
/** Prisma P2025: a linha sumiu entre a leitura e a escrita (excluida por outra requisicao). */
export function isRecordNotFound(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2025';
}

export async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
}
