import { Injectable } from "@nestjs/common";
import { DashboardService } from "../../dashboard/dashboard.service";
import { PrismaService } from "../../prisma/prisma.service";
import { SaveAssistantTurnDto } from "../dto/save-assistant-turn.dto";

const TURN_SELECT = {
  id: true,
  question: true,
  answer: true,
  focusArea: true,
  source: true,
  createdAt: true,
};

/** Historico das conversas do usuario com o assistente. */
@Injectable()
export class AssistantHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardService: DashboardService,
  ) {}

  async listHistory(userId: string, limit = 20) {
    return this.prisma.assistantTurn.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 50),
      select: TURN_SELECT,
    });
  }

  async saveHistoryTurn(userId: string, dto: SaveAssistantTurnDto) {
    const turn = await this.prisma.assistantTurn.create({
      data: {
        userId,
        question: dto.question.slice(0, 2000),
        answer: dto.answer.slice(0, 8000),
        focusArea: dto.focusArea ?? null,
        source: dto.source ?? null,
      },
      select: TURN_SELECT,
    });

    // A primeira conversa completa um passo do onboarding no dashboard; sem isto
    // o resumo em cache so mostraria o passo feito depois de ate 5 minutos.
    await this.dashboardService.invalidateSummary(userId);

    return turn;
  }
}
