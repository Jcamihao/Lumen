import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveUserToday } from '../common/materialization/due-window';
import { findCandidateTemplates } from './materialization/recurring-candidates';
import { materializeTemplate } from './materialization/recurring-catch-up';

export { MAX_CATCH_UP_PER_RUN } from '../common/materialization/catch-up';

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
    const candidates = await findCandidateTemplates(this.prisma, userId, now);

    if (candidates.length === 0) {
      return 0;
    }

    const round = { userId, now, today: await resolveUserToday(this.prisma, userId, now) };
    let created = 0;

    for (const template of candidates) {
      created += await materializeTemplate(this.prisma, template, round);
    }

    if (created > 0) {
      this.logger.log(`recurring_materialized userId=${userId} created=${created}`);
    }

    return created;
  }
}
