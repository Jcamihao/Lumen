import { PrismaService } from '../../prisma/prisma.service';
import { DateRange } from '../today-window';
import { resolveAll } from './resolve-all';
import { openTasksWhere } from './open-tasks.filter';

const TODAY_TASKS_LIMIT = 5;

export function findTodayTasks(prisma: PrismaService, userId: string, today: DateRange) {
  const dueToday = { ...openTasksWhere(userId), dueDate: { gte: today.start, lte: today.end } };

  return resolveAll({
    count: prisma.task.count({ where: dueToday }),
    items: prisma.task.findMany({
      where: dueToday,
      include: { category: true },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
      take: TODAY_TASKS_LIMIT,
    }),
  });
}

export function countOverdueTasks(prisma: PrismaService, userId: string, todayStart: Date) {
  return prisma.task.count({
    where: { ...openTasksWhere(userId), dueDate: { lt: todayStart } },
  });
}
