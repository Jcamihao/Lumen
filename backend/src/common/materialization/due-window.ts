import { PrismaService } from '../../prisma/prisma.service';
import { addDaysUtc, localToday } from '../../recurring-transactions/recurrence.util';

/**
 * Consulta barata e sem fuso: so segue se houver algo que possa estar vencido
 * em qualquer fuso (maximo UTC+14, ou seja, ate "amanha" em UTC).
 */
const LOOKAHEAD_DAYS = 1;

export function candidateCutoff(now: Date) {
  return addDaysUtc(now, LOOKAHEAD_DAYS);
}

/** "Hoje" do usuario no fuso dele. Sem fuso cadastrado, usa UTC. */
export async function resolveUserToday(prisma: PrismaService, userId: string, now: Date) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });

  return localToday(now, user?.timezone ?? 'UTC');
}
