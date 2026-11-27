import { Injectable } from "@nestjs/common";
import { PlanLimitException } from "../billing/plan-limit.exception";
import { EntitlementsService } from "../billing/entitlements.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { PrismaService } from "../prisma/prisma.service";
import { AssistantActionsService } from "./actions/assistant-actions.service";
import {
  AssistantFallbackOutcome,
  AssistantModule,
  AssistantPulse,
  AssistantReply,
  DashboardSummary,
} from "./assistant.types";
import { ApplyAssistantActionDto } from "./dto/apply-assistant-action.dto";
import { AskAssistantHistoryItemDto } from "./dto/ask-assistant.dto";
import { SaveAssistantTurnDto } from "./dto/save-assistant-turn.dto";
import { AssistantHistoryService } from "./history/assistant-history.service";
import { loadPrivacySettings, resolveLocalDisclaimer } from "./privacy/privacy-settings";
import { buildActionSuggestions } from "./reply/action-suggestions";
import { buildLocalReply } from "./reply/local-reply";
import { enrichReply } from "./reply/enrich-reply";
import { buildProactiveSignals } from "./reply/proactive-signals";
import { buildPulseQuestion, buildPulseSummary } from "./reply/pulse";
import { SelahClient } from "./selah/selah.client";
import { analyzeSpending } from "./spending/spending-analysis";

export type { AssistantFallbackOutcome } from "./assistant.types";

type AskOptions = { history?: AskAssistantHistoryItemDto[]; originModule?: AssistantModule };

/** Assistente do LUMEN: responde pelo SelahIA e, sem ele, pelo modo local. */
@Injectable()
export class AssistantService {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly selah: SelahClient,
    private readonly historyService: AssistantHistoryService,
    private readonly actionsService: AssistantActionsService,
  ) {}

  async ask(userId: string, question: string, options?: AskOptions): Promise<AssistantReply> {
    await this.entitlements.assertCanAskSelah(userId);

    const history = options?.history || [];
    const originModule = options?.originModule || "general";
    const [summary, privacySettings, spendingAnalysis] = await Promise.all([
      this.dashboardService.getSummary(userId) as Promise<DashboardSummary>,
      loadPrivacySettings(this.prisma, userId),
      analyzeSpending(this.prisma, userId),
    ]);
    const selahResult = await this.selah.ask(summary, privacySettings, question, history, originModule);
    const generatedAt = new Date().toISOString();

    if (selahResult.reply) {
      await this.entitlements.recordSelahQuestion(userId);
      return enrichReply(summary, question, selahResult.reply, history, originModule, generatedAt, spendingAnalysis);
    }

    const local = buildLocalReply(summary, question, resolveLocalDisclaimer(selahResult.reason));
    return enrichReply(summary, question, local, history, originModule, generatedAt, spendingAnalysis);
  }

  /**
   * Resposta do fallback do motor de conversa. Só leitura: o payload é o mesmo do assistente e só
   * o campo `answer` volta. Sem resposta da IA, devolve `unavailable` (nunca inventa texto local).
   * Crédito cobrado só quando há resposta.
   */
  async tryFallbackAnswer(userId: string, question: string): Promise<AssistantFallbackOutcome> {
    const privacySettings = await loadPrivacySettings(this.prisma, userId);

    if (!privacySettings.privacyNoticeAcceptedAt || !privacySettings.aiAssistantEnabled || !privacySettings.aiAssistantConsentAt) {
      return { status: "no_consent" };
    }

    try {
      await this.entitlements.assertCanAskSelah(userId);
    } catch (error) {
      if (error instanceof PlanLimitException) return { status: "blocked_by_plan" };
      throw error;
    }

    const summary = (await this.dashboardService.getSummary(userId)) as DashboardSummary;
    const selahResult = await this.selah.ask(summary, privacySettings, question, [], "general", this.selah.fallbackTimeoutMs());
    const answer = selahResult.reply?.answer.trim() ?? "";
    if (!answer) return { status: "unavailable" };

    await this.entitlements.recordSelahQuestion(userId);
    return { status: "answered", text: answer };
  }

  async getPulse(userId: string): Promise<AssistantPulse> {
    const summary = (await this.dashboardService.getSummary(userId)) as DashboardSummary;
    const generatedAt = new Date().toISOString();
    const signals = buildProactiveSignals(summary, "", "dashboard");
    const actions = buildActionSuggestions(summary, "", "dashboard", "Panorama").slice(0, 3);

    return {
      summary: buildPulseSummary(summary, signals),
      suggestedQuestion: buildPulseQuestion(summary),
      generatedAt,
      signals,
      actions,
    };
  }

  listHistory(userId: string, limit = 20) {
    return this.historyService.listHistory(userId, limit);
  }

  saveHistoryTurn(userId: string, dto: SaveAssistantTurnDto) {
    return this.historyService.saveHistoryTurn(userId, dto);
  }

  applyAction(userId: string, dto: ApplyAssistantActionDto) {
    return this.actionsService.applyAction(userId, dto);
  }
}
