import { ExportableUser } from "../export-user.query";

export function mapGoals(goals: ExportableUser["goals"]) {
  return goals.map((goal) => ({
    ...goal,
    targetAmount:
      goal.targetAmount === null || goal.targetAmount === undefined
        ? null
        : Number(goal.targetAmount),
    currentAmount: Number(goal.currentAmount),
  }));
}
