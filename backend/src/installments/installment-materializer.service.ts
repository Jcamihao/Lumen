import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveUserToday } from '../common/materialization/due-window';
import { findCandidatePlans } from './materialization/installment-candidates';
import { materializePlan } from './materialization/installment-catch-up';

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
    const candidates = await findCandidatePlans(this.prisma, userId, now);

    if (candidates.length === 0) {
      return 0;
    }

    const today = await resolveUserToday(this.prisma, userId, now);
    let created = 0;

    for (const plan of candidates) {
      created += await materializePlan(this.prisma, userId, plan, today);
    }

    if (created > 0) {
      this.logger.log(`installments_materialized userId=${userId} created=${created}`);
    }

    return created;
  }
}
