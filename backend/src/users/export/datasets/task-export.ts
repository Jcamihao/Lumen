import { ExportableUser } from "../export-user.query";

export function mapTasks(tasks: ExportableUser["tasks"]) {
  return tasks.map((task) => ({
    ...task,
    estimatedAmount:
      task.estimatedAmount !== null && task.estimatedAmount !== undefined
        ? Number(task.estimatedAmount)
        : null,
  }));
}
