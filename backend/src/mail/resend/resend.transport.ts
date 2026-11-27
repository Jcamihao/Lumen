import { Injectable, Logger } from "@nestjs/common";
import { MailDispatchResult, SendEmailOptions } from "../mail.types";
import { MailTransportResponse, postResendJson } from "./resend-http";
import { buildPayload } from "./resend.payload";
import { ResendSettings } from "./resend.settings";

function parseBody(body: string, logger: Logger): Record<string, unknown> {
  try {
    return body ? JSON.parse(body) : {};
  } catch (error) {
    logger.warn("Nao foi possivel interpretar a resposta JSON do Resend.");
    return {};
  }
}

function acceptedMessage(parsedBody: Record<string, unknown>): string {
  if (typeof parsedBody.id === "string") return "Email aceito pelo Resend.";
  if (typeof parsedBody.message === "string") return parsedBody.message;
  return "Email enviado para o Resend.";
}

/** Envia o email pela API do Resend. Sem configuracao completa, devolve "skipped". */
@Injectable()
export class ResendTransport {
  private readonly logger = new Logger(ResendTransport.name);

  constructor(private readonly settings: ResendSettings) {
    if (this.settings.isEnabled() && !this.settings.hasRequiredConfiguration()) {
      this.logger.warn("Resend esta habilitado, mas faltam RESEND_API_KEY ou RESEND_FROM_EMAIL.");
    }
  }

  async send(options: SendEmailOptions): Promise<MailDispatchResult> {
    if (!options.text && !options.html) {
      throw new Error("O envio de email exige pelo menos conteudo em texto ou HTML.");
    }
    const skipped = this.skipReason();
    if (skipped) return { provider: "resend", skipped: true, message: skipped };

    const response = await this.postJson(
      `${this.settings.baseUrl()}/emails`,
      this.settings.apiKey(),
      JSON.stringify(buildPayload(options, this.settings)),
      this.settings.timeoutMs(),
    );
    const parsedBody = parseBody(response.body, this.logger);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const details = typeof parsedBody.message === "string" ? parsedBody.message : response.body;
      throw new Error(`Resend retornou status ${response.statusCode}: ${details || "sem detalhes"}`);
    }
    return {
      provider: "resend",
      skipped: false,
      statusCode: response.statusCode,
      id: typeof parsedBody.id === "string" ? parsedBody.id : undefined,
      message: acceptedMessage(parsedBody),
    };
  }

  private skipReason(): string | null {
    if (!this.settings.isEnabled()) return "Resend desabilitado por configuracao.";
    if (!this.settings.hasRequiredConfiguration()) return "Resend nao configurado completamente.";
    return null;
  }

  private postJson(url: string, apiKey: string, body: string, timeoutMs: number): Promise<MailTransportResponse> {
    return postResendJson(url, apiKey, body, timeoutMs);
  }
}
