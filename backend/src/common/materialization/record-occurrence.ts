import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 'created': lancamento gravado agora.
 * 'existed': o banco ja tinha o lancamento daquela posicao; so o calendario andou.
 * 'lost': outra chamada levou o vencimento; quem chamou deve parar.
 */
export type OccurrenceOutcome = 'created' | 'existed' | 'lost';

/** Reivindicacao condicionada ao vencimento atual e gravacao do lancamento. */
export interface OccurrenceWrite {
  claim: (db: Prisma.TransactionClient) => Promise<{ count: number }>;
  insert: (tx: Prisma.TransactionClient) => Promise<unknown>;
}

/** Violacao do indice unico: o lancamento daquela posicao ja existe. */
function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === 'P2002';
}

/**
 * Reivindica o vencimento e grava o lancamento na mesma transacao: ou as duas
 * coisas acontecem, ou nenhuma. Se o banco recusar por unicidade, a transacao
 * desfaz a reivindicacao e aqui so se avanca o calendario, senao a mesma
 * posicao seria tentada para sempre.
 */
export async function recordOccurrence(prisma: PrismaService, write: OccurrenceWrite): Promise<OccurrenceOutcome> {
  try {
    const claimed = await prisma.$transaction(async (tx) => {
      if ((await write.claim(tx)).count === 0) {
        return false;
      }

      await write.insert(tx);
      return true;
    });

    return claimed ? 'created' : 'lost';
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    return (await write.claim(prisma)).count === 1 ? 'existed' : 'lost';
  }
}
