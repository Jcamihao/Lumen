import { CreateTaskDto } from "../../tasks/dto/create-task.dto";
import { optionalNumber, optionalString, optionalTaskPriority } from '../parsing/readers';
import { CreateGoalDto } from "../../goals/dto/create-goal.dto";
import { BadRequestException } from "@nestjs/common";
import { CreateReminderDto } from "../../reminders/dto/create-reminder.dto";

export function toCreateTaskDto(
  title: string | undefined,
  payload: Record<string, unknown>,
): CreateTaskDto {
  return {
    title: String(payload.title || title || "Nova tarefa do Selah").trim(),
    description: optionalString(payload.description),
    dueDate: optionalString(payload.dueDate),
    priority: optionalTaskPriority(payload.priority),
    categoryId: optionalString(payload.categoryId),
    hasFinancialImpact: Boolean(payload.hasFinancialImpact),
    estimatedAmount: optionalNumber(payload.estimatedAmount) ?? undefined,
    status: undefined,
    isRecurring: false,
    recurrenceRule: undefined,
    linkedGoalId: optionalString(payload.linkedGoalId),
    subtasks: [],
  };
}

export function toCreateGoalDto(
  title: string | undefined,
  payload: Record<string, unknown>,
): CreateGoalDto {
  // Ausente/null = cofrinho sem proposito definido (ex.: reserva de emergencia),
  // permitido de proposito. Quando o Selah manda um valor, ele precisa ser valido.
  const hasTargetAmount = payload.targetAmount !== undefined && payload.targetAmount !== null;
  const targetAmount = hasTargetAmount ? optionalNumber(payload.targetAmount) : null;

  if (hasTargetAmount && (targetAmount === null || targetAmount <= 0)) {
    throw new BadRequestException("O valor-alvo da meta sugerida pelo assistente e invalido.");
  }

  return {
    title: String(payload.title || title || "Nova meta do Selah").trim(),
    description: optionalString(payload.description),
    targetAmount: targetAmount ?? undefined,
    currentAmount: optionalNumber(payload.currentAmount) ?? 0,
    targetDate: optionalString(payload.targetDate),
    status: undefined,
  };
}

export function toCreateReminderDto(
  title: string | undefined,
  payload: Record<string, unknown>,
): CreateReminderDto {
  const remindAt = optionalString(payload.remindAt);

  if (!remindAt) {
    throw new BadRequestException("A acao do assistente precisa de uma data para o lembrete.");
  }

  return {
    title: String(payload.title || title || "Novo lembrete do Selah").trim(),
    remindAt,
    taskId: optionalString(payload.taskId),
    transactionId: optionalString(payload.transactionId),
    goalId: optionalString(payload.goalId),
  };
}
