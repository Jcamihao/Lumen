import { Injectable, Logger } from '@nestjs/common';
import { RecurrenceFrequency, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { addDaysUtc, localToday, nextOccurrence } from '../recurring-transactions/recurrence.util';
import { MAX_CATCH_UP_PER_RUN } from '../recurring-transactions/recurring-materializer.service';

/** Violacao do indice unico (compra parcelada + numero da parcela): a parcela daquela posicao ja existe. */
function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === 'P2002';
}

/**
 * Transforma parcelas vencidas de compras parceladas em lancamentos reais.
 *
 * Mesmo mecanismo (e mesmas garantias de idempotencia/concorrencia) do
 * RecurringMaterializerService, mas limitado por installmentsTotal em vez de
 * um endDate: gera exatamente N vezes e para, nao repete pra sempre.
 */
@Injectable()
export class InstallmentMaterializerService {
  private readonly logger = new Logger(InstallmentMaterializerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Gera as parcelas vencidas do usuario. Devolve quantas foram criadas. */
  async materializeDue(userId: string, now = new Date()): Promise<number> {
    const candidates = await this.prisma.installmentPurchase.findMany({
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

    for (const plan of candidates) {
      let due = plan.nextDueDate as Date;
      let installmentNumber = plan.installmentsGenerated + 1;
      let iterations = 0;

      while (
        due <= today &&
        installmentNumber <= plan.installmentsTotal &&
        iterations < MAX_CATCH_UP_PER_RUN
      ) {
        iterations += 1;

        const isLast = installmentNumber === plan.installmentsTotal;
        const next = isLast
          ? null
          : nextOccurrence(due, RecurrenceFrequency.MONTHLY, plan.anchorDay);
        // A ultima parcela absorve a sobra do arredondamento, pra soma bater com totalAmount.
        const amount = isLast
          ? plan.totalAmount.minus(plan.installmentAmount.times(plan.installmentsTotal - 1))
          : plan.installmentAmount;

        const claimData = {
          installmentsGenerated: installmentNumber,
          nextDueDate: next,
          ...(isLast ? { isActive: false } : {}),
        };
        let alreadyExisted = false;
        let claimed: boolean;

        try {
          claimed = await this.prisma.$transaction(async (tx) => {
            const claim = await tx.installmentPurchase.updateMany({
              where: { id: plan.id, nextDueDate: due, isActive: true },
              data: claimData,
            });

            if (claim.count === 0) {
              return false;
            }

            await tx.transaction.create({
              data: {
                userId,
                type: TransactionType.EXPENSE,
                description: plan.description,
                amount,
                date: due,
                categoryId: plan.categoryId,
                paymentMethod: plan.paymentMethod,
                // Herda o cartao da compra (nulo = cartao padrao). Arquivar depois nao impede.
                cardId: plan.cardId,
                installmentPurchaseId: plan.id,
                installmentNumber,
                installmentsTotal: plan.installmentsTotal,
              },
            });

            return true;
          });
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }

          // O banco recusou por ja existir a parcela nesta posicao (a transacao
          // desfez a reivindicacao). So avanca o calendario, senao esta posicao
          // seria tentada para sempre.
          alreadyExisted = true;
          const advanced = await this.prisma.installmentPurchase.updateMany({
            where: { id: plan.id, nextDueDate: due, isActive: true },
            data: claimData,
          });
          claimed = advanced.count === 1;
        }

        // Outra chamada ja levou esta parcela: para de tentar esta compra.
        if (!claimed) {
          break;
        }

        if (!alreadyExisted) {
          created += 1;
        }

        if (next === null) {
          break;
        }
        due = next;
        installmentNumber += 1;
      }
    }

    if (created > 0) {
      this.logger.log(`installments_materialized userId=${userId} created=${created}`);
    }

    return created;
  }
}
