import { PrismaService } from '../../prisma/prisma.service';

const REMINDERS_LIMIT = 4;

export function findUpcomingReminders(prisma: PrismaService, userId: string, now: Date) {
  return prisma.reminder.findMany({
    where: {
      userId,
      status: 'SCHEDULED',
      remindAt: {
        gte: now,
      },
    },
    select: {
      id: true,
      title: true,
      remindAt: true,
    },
    orderBy: { remindAt: 'asc' },
    take: REMINDERS_LIMIT,
  });
}
