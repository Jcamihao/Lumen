import { NotFoundException } from "@nestjs/common";
import { TasksService } from "./tasks.service";

describe("TasksService", () => {
  const buildPrisma = (overrides: Partial<Record<string, any>> = {}) =>
    ({
      task: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: "task-new", ...data }),
        ),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: "task-1", ...data }),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      taskCategory: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      goal: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      ...overrides,
    }) as any;

  const buildLifeEngine = () =>
    ({
      touchUserData: jest.fn().mockResolvedValue(undefined),
    }) as any;

  describe("list", () => {
    it("always scopes the query by the requesting user's id", async () => {
      const prisma = buildPrisma();
      const service = new TasksService(prisma, buildLifeEngine());

      await service.list("user-1", {} as any);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-1" }),
        }),
      );
    });
  });

  describe("update / remove — multi-tenancy", () => {
    it("update() never touches a task owned by another user", async () => {
      const prisma = buildPrisma();
      const service = new TasksService(prisma, buildLifeEngine());

      await expect(
        service.update("user-1", "task-owned-by-someone-else", {
          title: "tentativa de editar tarefa alheia",
        } as any),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-owned-by-someone-else", userId: "user-1" },
        }),
      );
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it("remove() never deletes a task owned by another user", async () => {
      const prisma = buildPrisma();
      const service = new TasksService(prisma, buildLifeEngine());

      await expect(
        service.remove("user-1", "task-owned-by-someone-else"),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-owned-by-someone-else", userId: "user-1" },
        }),
      );
      expect(prisma.task.delete).not.toHaveBeenCalled();
    });
  });

  describe("recurrence on completion", () => {
    it("spawns the next occurrence when a recurring task is marked DONE", async () => {
      const existingTask = {
        id: "task-1",
        userId: "user-1",
        title: "Revisar orcamento",
        priority: "MEDIUM",
        isRecurring: true,
        recurrenceRule: "weekly",
        dueDate: new Date("2026-08-10T00:00:00.000Z"),
        categoryId: null,
        hasFinancialImpact: false,
        estimatedAmount: null,
        linkedGoalId: null,
      };
      const prisma = buildPrisma({
        task: {
          findMany: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(existingTask),
          update: jest.fn().mockResolvedValue({
            ...existingTask,
            status: "DONE",
          }),
          create: jest.fn().mockResolvedValue({ id: "task-2" }),
          delete: jest.fn(),
        },
      });
      const service = new TasksService(prisma, buildLifeEngine());

      await service.update("user-1", "task-1", { status: "DONE" } as any);

      expect(prisma.task.create).toHaveBeenCalledTimes(1);
      const spawnedData = prisma.task.create.mock.calls[0][0].data;
      expect(spawnedData.userId).toBe("user-1");
      expect(spawnedData.status).toBe("PENDING");
      expect(spawnedData.isRecurring).toBe(true);
      expect(spawnedData.dueDate.toISOString()).toBe(
        "2026-08-17T00:00:00.000Z",
      );
    });

    it("does not spawn a next occurrence for a non-recurring task", async () => {
      const existingTask = {
        id: "task-1",
        userId: "user-1",
        title: "Tarefa unica",
        isRecurring: false,
        recurrenceRule: null,
        dueDate: new Date("2026-08-10T00:00:00.000Z"),
      };
      const prisma = buildPrisma({
        task: {
          findMany: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(existingTask),
          update: jest.fn().mockResolvedValue({
            ...existingTask,
            status: "DONE",
          }),
          create: jest.fn(),
          delete: jest.fn(),
        },
      });
      const service = new TasksService(prisma, buildLifeEngine());

      await service.update("user-1", "task-1", { status: "DONE" } as any);

      expect(prisma.task.create).not.toHaveBeenCalled();
    });
  });
});
