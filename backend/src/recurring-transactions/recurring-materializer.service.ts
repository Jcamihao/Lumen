import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { addDaysUtc, localToday, nextOccurrence } from './recurrence.util';

/**
 * Teto de vencimentos gerados por conta a cada rodada. Uma conta so acumula
 * varios vencimentos se ficou muito tempo sem ninguem abrir o app; o resto sai
 * na rodada seguinte, em vez de travar uma requisicao.
 */
export const MAX_CATCH_UP_PER_RUN = 24;

/** Violacao do indice unico (conta fixa + data): o lancamento daquela data ja existe. */
function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === 'P2002';
}

/**
 * Transforma contas fixas vencidas em lancamentos reais.
 *
 * Fica separado do CRUD de proposito: so depende do Prisma, entao dashboard,
 * lista de transacoes e workers podem usa-lo sem criar ciclo de modulos com o
 * LifeEngine.
 *
 * Idempotente e seguro sob concorrencia: cada vencimento e "reivindicado" com
 * um updateMany condicionado ao nextDueDate atual, na mesma transacao que cria
 * o lancamento. Duas chamadas simultaneas nunca geram o mesmo vencimento duas
 * vezes, e apagar um lancamento gerado nao o recria (o marco e o nextDueDate
 * da conta, nao a existencia do lancamento).
 */
@Injectable()
export class RecurringMaterializerService {
  private readonly logger = new Logger(RecurringMaterializerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Gera os lancamentos vencidos do usuario. Devolve quantos foram criados. */
  async materializeDue(userId: string, now = new Date()): Promise<number> {
    // Consulta barata e sem fuso: so segue se houver algo que possa estar vencido
    // em qualquer fuso (maximo UTC+14, ou seja, ate "amanha" em UTC).
    const candidates = await this.prisma.recurringTransaction.findMany({
      where: {
        userId,
        isActive: true,
        nextDueDate: { lte: addDaysUtc(now, 1) },
      },
    });

    if (candidates.length === 0) {
      return 0;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const today = localToday(now, user?.timezone ?? 'UTC');
    let created = 0;

    for (const template of candidates) {
      let due = template.nextDueDate;
      let iterations = 0;

      while (due <= today && iterations < MAX_CATCH_UP_PER_RUN) {
        iterations += 1;

        // Conta que passou do fim: encerra sem gerar mais nada.
        if (template.endDate && due > template.endDate) {
          await this.prisma.recurringTransaction.updateMany({
            where: { id: template.id, nextDueDate: due, isActive: true },
            data: { isActive: false },
          });
          break;
        }

        const next = nextOccurrence(due, template.frequency, template.anchorDay);
        const finished = Boolean(template.endDate && next > template.endDate);

        const claimData = {
          nextDueDate: next,
          lastGeneratedAt: now,
          ...(finished ? { isActive: false } : {}),
        };
        let alreadyExisted = false;
        let claimed: boolean;

        try {
          claimed = await this.prisma.$transaction(async (tx) => {
            const claim = await tx.recurringTransaction.updateMany({
              where: { id: template.id, nextDueDate: due, isActive: true },
              data: claimData,
            });

            if (claim.count === 0) {
              return false;
            }

            await tx.transaction.create({
              data: {
                userId,
                type: template.type,
                description: template.description,
                amount: template.amount,
                date: due,
                categoryId: template.categoryId,
                paymentMethod: template.paymentMethod,
                // Herda o cartao do modelo (nulo = cartao padrao). Arquivar depois nao impede.
                cardId: template.cardId,
                recurringTransactionId: template.id,
              },
            });

            return true;
          });
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }

          // O banco recusou por ja existir lancamento desta conta nesta data (a
          // transacao desfez a reivindicacao). Nao ha o que gerar: so avanca o
          // calendario, senao esta data seria tentada para sempre.
          alreadyExisted = true;
          const advanced = await this.prisma.recurringTransaction.updateMany({
            where: { id: template.id, nextDueDate: due, isActive: true },
            data: claimData,
          });
          claimed = advanced.count === 1;
        }

        // Outra chamada ja levou este vencimento: para de tentar esta conta.
        if (!claimed) {
          break;
        }

        if (!alreadyExisted) {
          created += 1;
        }
        due = next;

        if (finished) {
          break;
        }
      }
    }

    if (created > 0) {
      this.logger.log(`recurring_materialized userId=${userId} created=${created}`);
    }

    return created;
  }
}
