import { PrismaService } from '../../prisma/prisma.service';

const NOTIFICATIONS_LIMIT = 4;

export function findUnreadNotifications(prisma: PrismaService, userId: string) {
  return prisma.notification.findMany({
    where: {
      userId,
      isRead: false,
    },
    select: {
      id: true,
      title: true,
      message: true,
      isRead: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: NOTIFICATIONS_LIMIT,
  });
}
