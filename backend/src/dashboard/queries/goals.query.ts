import { PrismaService } from '../../prisma/prisma.service';

const GOALS_LIMIT = 4;

export function findActiveGoals(prisma: PrismaService, userId: string) {
  return prisma.goal.findMany({
    where: {
      userId,
      status: {
        in: ['ACTIVE', 'PLANNED', 'ACHIEVED'],
      },
    },
    select: {
      id: true,
      title: true,
      description: true,
      targetAmount: true,
      currentAmount: true,
      targetDate: true,
      status: true,
    },
    orderBy: [{ status: 'asc' }, { targetDate: 'asc' }],
    take: GOALS_LIMIT,
  });
}
