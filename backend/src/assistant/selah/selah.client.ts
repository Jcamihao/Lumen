import { randomUUID } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import { AssistantModule, AssistantPrivacySettings, AssistantReply, DashboardSummary, SelahAttemptReason, SelahResponse } from "../assistant.types";
import { AskAssistantHistoryItemDto } from "../dto/ask-assistant.dto";
import { JsonResponse, postJson } from "./post-json";
import { buildSelahPayload } from "./selah-payload";
import { normalizeSelahReply } from "./selah-reply";
import { SelahSettings } from "./selah-settings";

export type SelahResult = { reply: AssistantReply | null; attempted: boolean; reason: SelahAttemptReason };

const unavailable = (): SelahResult => ({ reply: null, attempted: true, reason: "selah_unavailable" });
const skipped = (reason: SelahAttemptReason): SelahResult => ({ reply: null, attempted: false, reason });

/** Conversa com o SelahIA. Qualquer falha vira "indisponivel", para o chamador usar o modo local. */
@Injectable()
export class SelahClient {
  private readonly logger = new Logger(SelahClient.name);

  constructor(private readonly settings: SelahSettings) {}

  fallbackTimeoutMs(): number {
    return this.settings.fallbackTimeoutMs();
  }

  async ask(
    summary: DashboardSummary,
    privacySettings: AssistantPrivacySettings,
    question: string,
    history: AskAssistantHistoryItemDto[],
    originModule: AssistantModule,
    timeoutMs?: number,
  ): Promise<SelahResult> {
    const blocked = this.blockedReason(privacySettings);
    if (blocked) return skipped(blocked);

    const requestId = randomUUID();
    const body = JSON.stringify(buildSelahPayload(summary, question, history, originModule));
    try {
      const response = await this.postJson(this.url(), body, this.headers(body, requestId), timeoutMs ?? this.settings.timeoutMs());
      return this.readResponse(response, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido no SelahIA.";
      this.logger.warn(`[${requestId}] Falha ao consultar SelahIA: ${message}`);
      return unavailable();
    }
  }

  private blockedReason(privacy: AssistantPrivacySettings): SelahAttemptReason {
    if (!privacy.privacyNoticeAcceptedAt) return "privacy_notice_missing";
    if (!privacy.aiAssistantEnabled || !privacy.aiAssistantConsentAt) return "ai_consent_missing";
    const enabled = this.settings.readBooleanEnv("SELAH_ASSISTANT_ENABLED");
    return !enabled || !this.settings.readEnv("SELAH_BASE_URL") ? "integration_disabled" : null;
  }

  private url(): string {
    const baseUrl = this.settings.readEnv("SELAH_BASE_URL");
    const route = this.settings.readEnv("SELAH_ASSISTANT_ROUTE") || "/v1/adapters/lumen/life-assistant/chat";
    return `${baseUrl.replace(/\/+$/, "")}${route.startsWith("/") ? route : `/${route}`}`;
  }

  private headers(body: string, requestId: string): Record<string, string> {
    const apiKey = this.settings.readEnv("SELAH_API_KEY");
    return {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      "X-Source-App": this.settings.readEnv("SELAH_SOURCE_APP") || "LumenBack",
      "X-Request-Id": requestId,
      ...(apiKey ? { "X-Selah-Api-Key": apiKey } : {}),
    };
  }

  private readResponse(response: JsonResponse, requestId: string): SelahResult {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      this.logger.warn(
        response.statusCode === 429
          ? `[${requestId}] SelahIA aplicou rate limit a este app (429); usando o modo local: ${response.body.slice(0, 240)}`
          : `[${requestId}] SelahIA respondeu com erro ${response.statusCode}: ${response.body.slice(0, 240)}`,
      );
      return unavailable();
    }
    let payload: SelahResponse;
    try {
      payload = JSON.parse(response.body) as SelahResponse;
    } catch (_error) {
      this.logger.warn(`[${requestId}] SelahIA retornou um payload invalido: ${response.body.slice(0, 240)}`);
      return unavailable();
    }
    return { reply: normalizeSelahReply(payload), attempted: true, reason: null };
  }

  // Ponto unico de rede: os testes o substituem para simular o SelahIA.
  private postJson(url: string, body: string, headers: Record<string, string>, timeoutMs: number) {
    return postJson(url, body, headers, timeoutMs);
  }
}
