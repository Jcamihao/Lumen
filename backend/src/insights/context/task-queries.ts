import { PrismaService } from '../../prisma/prisma.service';
import { TimeWindows } from './time-windows';

const OPEN_TASK_STATUSES: Array<'PENDING' | 'IN_PROGRESS'> = ['PENDING', 'IN_PROGRESS'];

export function findOverdueTasks(prisma: PrismaService, userId: string, w: TimeWindows) {
  return prisma.task.findMany({
    where: { userId, status: { in: OPEN_TASK_STATUSES }, dueDate: { lt: w.todayStart } },
  });
}

export function findTasksToday(prisma: PrismaService, userId: string, w: TimeWindows) {
  return prisma.task.findMany({
    where: { userId, dueDate: { gte: w.todayStart, lte: w.todayEnd }, status: { in: OPEN_TASK_STATUSES } },
  });
}

export function findOpenGoals(prisma: PrismaService, userId: string) {
  return prisma.goal.findMany({ where: { userId, status: { in: ['ACTIVE', 'PLANNED'] } } });
}

export function findRemindersToday(prisma: PrismaService, userId: string, w: TimeWindows) {
  return prisma.reminder.findMany({ where: { userId, remindAt: { gte: w.todayStart, lte: w.todayEnd } } });
}
