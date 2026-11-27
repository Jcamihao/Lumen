import { TaskStatus } from '@prisma/client';

const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];

/** Tarefas ainda em aberto do usuario: base de toda consulta de pendencias. */
export const openTasksWhere = (userId: string) => ({ userId, status: { in: OPEN_TASK_STATUSES } });
