import * as http from "node:http";
import * as https from "node:https";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type SendEmailOptions = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  tags?: string[];
  replyTo?: string;
};

type MailTransportResponse = {
  statusCode: number;
  body: string;
};

type MailDispatchResult = {
  provider: "resend";
  skipped: boolean;
  statusCode?: number;
  id?: string;
  message: string;
};

type ResendTag = {
  name: string;
  value: string;
};

type ResendEmailPayload = {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  tags?: ResendTag[];
};

type WelcomeEmailInput = {
  email: string;
  name: string;
};

type ReminderEmailInput = {
  email: string;
  name?: string | null;
  title: string;
  contextTitle?: string | null;
  remindAt: Date;
  timezone?: string | null;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {
    if (this.isResendEnabled() && !this.hasRequiredConfiguration()) {
      this.logger.warn(
        "Resend esta habilitado, mas faltam RESEND_API_KEY ou RESEND_FROM_EMAIL.",
      );
    }
  }

  async sendWelcomeEmail(input: WelcomeEmailInput) {
    const appUrl =
      this.configService.get<string>("app.appUrl") ?? "http://localhost:3000";
    const greetingName = this.firstName(input.name);
    const subject = "Sua conta no LUMEN esta pronta";
    const text =
      `Oi ${greetingName},\n\n` +
      "Sua conta no LUMEN foi criada com sucesso.\n" +
      `Voce ja pode acessar sua area em ${appUrl}.\n\n` +
      "Obrigado por construir sua clareza com a gente.\n" +
      "Equipe LUMEN";
    const html = [
      '<html><body style="font-family: Arial, sans-serif; color: #1f2937;">',
      `<p>Oi <strong>${this.escapeHtml(greetingName)}</strong>,</p>`,
      "<p>Sua conta no <strong>LUMEN</strong> foi criada com sucesso.</p>",
      `<p>Voce ja pode acessar sua area em <a href="${this.escapeHtml(
        appUrl,
      )}">${this.escapeHtml(appUrl)}</a>.</p>`,
      "<p>Obrigado por construir sua clareza com a gente.<br />Equipe LUMEN</p>",
      "</body></html>",
    ].join("");

    return this.sendEmail({
      to: input.email,
      subject,
      text,
      html,
      tags: ["welcome", "auth"],
    });
  }

  async sendReminderEmail(input: ReminderEmailInput) {
    const greetingName = input.name ? this.firstName(input.name) : "voce";
    const formattedDate = this.formatDateTime(input.remindAt, input.timezone);
    const subject = `LUMEN: lembrete - ${input.title}`;
    const contextLine = input.contextTitle
      ? `Contexto relacionado: ${input.contextTitle}.`
      : null;
    const text = [
      `Oi ${greetingName},`,
      "",
      `Seu lembrete "${input.title}" foi disparado em ${formattedDate}.`,
      contextLine,
      "",
      "Abra o LUMEN para revisar os proximos passos.",
      "Equipe LUMEN",
    ]
      .filter(Boolean)
      .join("\n");
    const html = [
      '<html><body style="font-family: Arial, sans-serif; color: #1f2937;">',
      `<p>Oi <strong>${this.escapeHtml(greetingName)}</strong>,</p>`,
      `<p>Seu lembrete <strong>${this.escapeHtml(
        input.title,
      )}</strong> foi disparado em ${this.escapeHtml(formattedDate)}.</p>`,
      input.contextTitle
        ? `<p>Contexto relacionado: ${this.escapeHtml(input.contextTitle)}.</p>`
        : "",
      "<p>Abra o LUMEN para revisar os proximos passos.</p>",
      "<p>Equipe LUMEN</p>",
      "</body></html>",
    ].join("");

    return this.sendEmail({
      to: input.email,
      subject,
      text,
      html,
      tags: ["reminder"],
    });
  }

  async sendEmail(options: SendEmailOptions): Promise<MailDispatchResult> {
    if (!options.text && !options.html) {
      throw new Error(
        "O envio de email exige pelo menos conteudo em texto ou HTML.",
      );
    }

    if (!this.isResendEnabled()) {
      return {
        provider: "resend",
        skipped: true,
        message: "Resend desabilitado por configuracao.",
      };
    }

    if (!this.hasRequiredConfiguration()) {
      return {
        provider: "resend",
        skipped: true,
        message: "Resend nao configurado completamente.",
      };
    }

    const endpoint = `${this.getBaseUrl()}/emails`;
    const payload = this.buildPayload(options);
    const response = await this.postJson(
      endpoint,
      this.getApiKey(),
      JSON.stringify(payload),
      this.getTimeoutMs(),
    );

    let parsedBody: Record<string, unknown> = {};

    try {
      parsedBody = response.body ? JSON.parse(response.body) : {};
    } catch (error) {
      this.logger.warn(
        "Nao foi possivel interpretar a resposta JSON do Resend.",
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const details =
        typeof parsedBody.message === "string"
          ? parsedBody.message
          : response.body;
      throw new Error(
        `Resend retornou status ${response.statusCode}: ${details || "sem detalhes"}`,
      );
    }

    return {
      provider: "resend",
      skipped: false,
      statusCode: response.statusCode,
      id: typeof parsedBody.id === "string" ? parsedBody.id : undefined,
      message:
        typeof parsedBody.id === "string"
          ? "Email aceito pelo Resend."
          : typeof parsedBody.message === "string"
            ? parsedBody.message
            : "Email enviado para o Resend.",
    };
  }

  private buildPayload(options: SendEmailOptions): ResendEmailPayload {
    const payload: ResendEmailPayload = {
      from: this.formatAddress(this.getFromEmail(), this.getFromName()),
      to: this.expandRecipients(options.to),
      subject: options.subject,
    };

    if (options.text) {
      payload.text = options.text;
    }

    if (options.html) {
      payload.html = options.html;
    }

    const replyTo = options.replyTo ?? this.getReplyTo();
    if (replyTo) {
      payload.headers = {
        "Reply-To": replyTo,
      };
    }

    const tags = this.buildTags(options.tags ?? []);
    if (tags.length > 0) {
      payload.tags = tags;
    }

    return payload;
  }

  private buildTags(tags: string[]) {
    const usedNames = new Set<string>();

    return tags
      .map((tag, index) => {
        const sanitized = this.sanitizeTag(tag);
        const baseName = sanitized || `tag_${index + 1}`;
        let name = baseName;

        if (usedNames.has(name)) {
          name = `${baseName}_${index + 1}`;
        }

        usedNames.add(name);

        return {
          name,
          value: "true",
        };
      })
      .filter((tag) => Boolean(tag.name));
  }

  private sanitizeTag(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 256);
  }

  private expandRecipients(value: string | string[]) {
    const recipients = Array.isArray(value) ? value : [value];
    return recipients.map((recipient) => recipient.trim()).filter(Boolean);
  }

  private formatAddress(email: string, name: string) {
    return `${name} <${email}>`;
  }

  private formatDateTime(date: Date, timeZone?: string | null) {
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: timeZone || "America/Sao_Paulo",
      }).format(date);
    } catch (error) {
      return date.toISOString();
    }
  }

  private firstName(name: string) {
    return name.trim().split(/\s+/)[0] || "voce";
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private async postJson(
    urlString: string,
    apiKey: string,
    body: string,
    timeoutMs: number,
  ): Promise<MailTransportResponse> {
    const url = new URL(urlString);
    const requestImpl =
      url.protocol === "https:" ? https.request : http.request;

    return new Promise((resolve, reject) => {
      const request = requestImpl(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? parseInt(url.port, 10) : undefined,
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            Accept: "application/json",
          },
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          response.on("end", () => {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy(
          new Error(`Timeout ao enviar email para o Resend (${timeoutMs}ms).`),
        );
      });

      request.on("error", reject);
      request.write(body);
      request.end();
    });
  }

  private isResendEnabled() {
    return Boolean(this.configService.get<boolean>("mail.enabled"));
  }

  private hasRequiredConfiguration() {
    return Boolean(this.getApiKey() && this.getFromEmail());
  }

  private getApiKey() {
    return this.configService.get<string>("mail.apiKey") ?? "";
  }

  private getBaseUrl() {
    return (
      this.configService.get<string>("mail.baseUrl") ?? "https://api.resend.com"
    );
  }

  private getFromEmail() {
    return this.configService.get<string>("mail.fromEmail") ?? "";
  }

  private getFromName() {
    return this.configService.get<string>("mail.fromName") ?? "LUMEN";
  }

  private getReplyTo() {
    return this.configService.get<string>("mail.replyTo") ?? "";
  }

  private getTimeoutMs() {
    return this.configService.get<number>("mail.timeoutMs") ?? 10000;
  }
}
