import { BadRequestException, Injectable } from "@nestjs/common";
import { GoalsService } from "../../goals/goals.service";
import { RemindersService } from "../../reminders/reminders.service";
import { TasksService } from "../../tasks/tasks.service";
import { ApplyAssistantActionDto } from "../dto/apply-assistant-action.dto";
import { toCreateGoalDto, toCreateReminderDto, toCreateTaskDto } from "./action-dtos";

/** Aplica uma acao sugerida pelo assistente (criar tarefa, meta ou lembrete; ou abrir um modulo). */
@Injectable()
export class AssistantActionsService {
  constructor(
    private readonly tasksService: TasksService,
    private readonly goalsService: GoalsService,
    private readonly remindersService: RemindersService,
  ) {}

  async applyAction(userId: string, dto: ApplyAssistantActionDto) {
    if (dto.kind === "open_module") {
      return { success: true, kind: dto.kind, route: dto.route || null };
    }

    const payload = dto.payload || {};

    if (dto.kind === "create_task") {
      return {
        success: true,
        kind: dto.kind,
        entity: await this.tasksService.create(userId, toCreateTaskDto(dto.title, payload)),
      };
    }

    if (dto.kind === "create_goal") {
      return {
        success: true,
        kind: dto.kind,
        entity: await this.goalsService.create(userId, toCreateGoalDto(dto.title, payload)),
      };
    }

    if (dto.kind === "create_reminder") {
      return {
        success: true,
        kind: dto.kind,
        entity: await this.remindersService.create(userId, toCreateReminderDto(dto.title, payload)),
      };
    }

    throw new BadRequestException("Acao do assistente nao suportada.");
  }
}
