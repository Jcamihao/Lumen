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
  headers?: Record<string, string>;
};

export type UnsubscribeLinks = {
  /** Pagina do frontend que confirma o descadastro (link visivel no rodape). */
  pageUrl: string;
  /** Endpoint POST da API para o one-click do cliente de email (RFC 8058). */
  oneClickUrl: string;
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
  verifyUrl?: string;
};

type EmailVerificationInput = {
  email: string;
  name?: string | null;
  verifyUrl: string;
  expiresInHours: number;
};

type PasswordResetEmailInput = {
  email: string;
  name?: string | null;
  resetUrl: string;
  expiresInMinutes: number;
};

type PasswordChangedEmailInput = {
  email: string;
  name?: string | null;
};

type ReminderEmailInput = {
  email: string;
  name?: string | null;
  title: string;
  contextTitle?: string | null;
  remindAt: Date;
  timezone?: string | null;
  unsubscribe?: UnsubscribeLinks;
};

type InsightEscalationEmailInput = {
  email: string;
  name?: string | null;
  message: string;
  unsubscribe?: UnsubscribeLinks;
};

type WeeklyDigestEmailInput = {
  email: string;
  name?: string | null;
  preferredCurrency: string;
  overdueTasksCount: number;
  balance: number;
  monthlyExpenses: number;
  monthlyIncome: number;
  goals: { title: string; currentAmount: number; targetAmount: number | null }[];
  unsubscribe?: UnsubscribeLinks;
};

type MfaBypassEmailInput = {
  email: string;
  name?: string | null;
  otp: string;
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
    const frontendUrl =
      this.configService.get<string>("app.frontendUrl") ??
      "http://localhost:4200";
    const greetingName = this.firstName(input.name);
    const subject = "Sua conta no LUMEN esta pronta";
    const text = [
      `Oi ${greetingName},`,
      "",
      "Sua conta no LUMEN foi criada com sucesso.",
      input.verifyUrl
        ? `Confirme seu email para receber lembretes e resumos: ${input.verifyUrl}`
        : null,
      `Voce ja pode acessar sua area em ${frontendUrl}.`,
      "",
      "Obrigado por construir sua clareza com a gente.",
      "Equipe LUMEN",
    ]
      .filter((line) => line !== null)
      .join("\n");
    const html = [
      this.emailOpen(),
      `<p>Oi <strong>${this.escapeHtml(greetingName)}</strong>,</p>`,
      "<p>Sua conta no <strong>LUMEN</strong> foi criada com sucesso.</p>",
      input.verifyUrl
        ? `<p>Confirme seu email para receber lembretes e resumos:</p>${this.actionButton(input.verifyUrl, "Confirmar email")}`
        : "",
      `<p>Voce ja pode acessar sua area em <a href="${this.escapeHtml(
        frontendUrl,
      )}">${this.escapeHtml(frontendUrl)}</a>.</p>`,
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

  async sendEmailVerificationEmail(input: EmailVerificationInput) {
    const greetingName = input.name ? this.firstName(input.name) : "voce";
    const subject = "LUMEN: confirme seu email";
    const text = [
      `Oi ${greetingName},`,
      "",
      "Confirme seu email para receber lembretes e resumos do LUMEN:",
      input.verifyUrl,
      "",
      `Este link expira em ${input.expiresInHours} horas.`,
      "Se voce nao criou uma conta no LUMEN, ignore este email.",
      "Equipe LUMEN",
    ].join("\n");
    const html = [
      this.emailOpen(),
      `<p>Oi <strong>${this.escapeHtml(greetingName)}</strong>,</p>`,
      "<p>Confirme seu email para receber lembretes e resumos do <strong>LUMEN</strong>:</p>",
      this.actionButton(input.verifyUrl, "Confirmar email"),
      `<p>Este link expira em <strong>${input.expiresInHours} horas</strong>.</p>`,
      "<p style='color:#6b7280;font-size:0.875rem;'>Se voce nao criou uma conta no LUMEN, ignore este email.</p>",
      "<p>Equipe LUMEN</p>",
      "</body></html>",
    ].join("");

    return this.sendEmail({
      to: input.email,
      subject,
      text,
      html,
      tags: ["email_verification", "auth"],
    });
  }

  async sendPasswordResetEmail(input: PasswordResetEmailInput) {
    const greetingName = input.name ? this.firstName(input.name) : "voce";
    const subject = "LUMEN: redefinir sua senha";
    const text = [
      `Oi ${greetingName},`,
      "",
      "Recebemos um pedido para redefinir a senha da sua conta no LUMEN.",
      "Crie uma nova senha por este link:",
      input.resetUrl,
      "",
      `Ele expira em ${input.expiresInMinutes} minutos e so pode ser usado uma vez.`,
      "Se nao foi voce, ignore este email — sua senha continua a mesma.",
      "Equipe LUMEN",
    ].join("\n");
    const html = [
      this.emailOpen(),
      `<p>Oi <strong>${this.escapeHtml(greetingName)}</strong>,</p>`,
      "<p>Recebemos um pedido para redefinir a senha da sua conta no <strong>LUMEN</strong>.</p>",
      this.actionButton(input.resetUrl, "Criar nova senha"),
      `<p>Este link expira em <strong>${input.expiresInMinutes} minutos</strong> e so pode ser usado uma vez.</p>`,
      "<p style='color:#6b7280;font-size:0.875rem;'>Se nao foi voce, ignore este email — sua senha continua a mesma.</p>",
      "<p>Equipe LUMEN</p>",
      "</body></html>",
    ].join("");

    return this.sendEmail({
      to: input.email,
      subject,
      text,
      html,
      tags: ["password_reset", "auth"],
    });
  }

  async sendPasswordChangedEmail(input: PasswordChangedEmailInput) {
    const greetingName = input.name ? this.firstName(input.name) : "voce";
    const subject = "LUMEN: sua senha foi alterada";
    const text = [
      `Oi ${greetingName},`,
      "",
      "A senha da sua conta no LUMEN acabou de ser alterada e todas as sessoes abertas foram encerradas.",
      "Se nao foi voce, redefina a senha de novo e entre em contato com a gente.",
      "Equipe LUMEN",
    ].join("\n");
    const html = [
      this.emailOpen(),
      `<p>Oi <strong>${this.escapeHtml(greetingName)}</strong>,</p>`,
      "<p>A senha da sua conta no <strong>LUMEN</strong> acabou de ser alterada e todas as sessoes abertas foram encerradas.</p>",
      "<p style='color:#6b7280;font-size:0.875rem;'>Se nao foi voce, redefina a senha de novo e entre em contato com a gente.</p>",
      "<p>Equipe LUMEN</p>",
      "</body></html>",
    ].join("");

    return this.sendEmail({
      to: input.email,
      subject,
      text,
      html,
      tags: ["password_changed", "auth"],
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
      .join("\n") + this.footerText(input.unsubscribe);
    const html = [
      this.emailOpen(),
      `<p>Oi <strong>${this.escapeHtml(greetingName)}</strong>,</p>`,
      `<p>Seu lembrete <strong>${this.escapeHtml(
        input.title,
      )}</strong> foi disparado em ${this.escapeHtml(formattedDate)}.</p>`,
      input.contextTitle
        ? `<p>Contexto relacionado: ${this.escapeHtml(input.contextTitle)}.</p>`
        : "",
      "<p>Abra o LUMEN para revisar os proximos passos.</p>",
      "<p>Equipe LUMEN</p>",
      this.footerHtml(input.unsubscribe),
      "</body></html>",
    ].join("");

    return this.sendEmail({
      to: input.email,
      subject,
      text,
      html,
      tags: ["reminder"],
      headers: this.unsubscribeHeaders(input.unsubscribe),
    });
  }

  /**
   * Dispara quando um insight CRITICAL fica notificado (in-app) sem
   * resolucao por dias seguidos — o usuario viu o alerta no app mas nao
   * agiu, ou nem abriu o app depois. Canal diferente do in-app, uma unica
   * vez por insight (controlado por escalatedAt no chamador).
   */
  async sendInsightEscalationEmail(input: InsightEscalationEmailInput) {
    const greetingName = input.name ? this.firstName(input.name) : "voce";
    const subject = "LUMEN: um alerta continua sem resolucao";
    const text = [
      `Oi ${greetingName},`,
      "",
      `Isso ainda esta pendente: ${input.message}`,
      "",
      "Ja avisamos isso dentro do app ha alguns dias e continua sem resolucao.",
      "Abra o LUMEN quando puder dar uma olhada.",
      "Equipe LUMEN",
    ].join("\n") + this.footerText(input.unsubscribe);
    const html = [
      this.emailOpen(),
      `<p>Oi <strong>${this.escapeHtml(greetingName)}</strong>,</p>`,
      `<p>Isso ainda esta pendente: <strong>${this.escapeHtml(input.message)}</strong></p>`,
      "<p>Ja avisamos isso dentro do app ha alguns dias e continua sem resolucao.</p>",
      "<p>Abra o LUMEN quando puder dar uma olhada.</p>",
      "<p>Equipe LUMEN</p>",
      this.footerHtml(input.unsubscribe),
      "</body></html>",
    ].join("");

    return this.sendEmail({
      to: input.email,
      subject,
      text,
      html,
      tags: ["insight_escalation"],
      headers: this.unsubscribeHeaders(input.unsubscribe),
    });
  }

  /** Resumo semanal — cadencia separada do pulso diario, panorama da semana. */
  async sendWeeklyDigestEmail(input: WeeklyDigestEmailInput) {
    const greetingName = input.name ? this.firstName(input.name) : "voce";
    const money = (value: number) =>
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: input.preferredCurrency || "BRL",
      }).format(value);

    const overdueLine =
      input.overdueTasksCount > 0
        ? `${input.overdueTasksCount} tarefa(s) atrasada(s).`
        : "Nenhuma tarefa atrasada.";

    const goalLines = input.goals.slice(0, 3).map((goal) => {
      if (goal.targetAmount === null) {
        return `${goal.title}: ${money(goal.currentAmount)} guardados (sem alvo definido)`;
      }
      const pct = goal.targetAmount > 0
        ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100))
        : 0;
      return `${goal.title}: ${pct}% (${money(goal.currentAmount)} de ${money(goal.targetAmount)})`;
    });

    const subject = "LUMEN: seu resumo da semana";
    const text = [
      `Oi ${greetingName},`,
      "",
      "Seu resumo da semana:",
      `- Saldo atual: ${money(input.balance)}`,
      `- Receitas do mes: ${money(input.monthlyIncome)}`,
      `- Despesas do mes: ${money(input.monthlyExpenses)}`,
      `- ${overdueLine}`,
      ...(goalLines.length ? ["", "Metas em andamento:", ...goalLines.map((line) => `- ${line}`)] : []),
      "",
      "Abra o LUMEN para o detalhe completo.",
      "Equipe LUMEN",
    ].join("\n") + this.footerText(input.unsubscribe);
    const html = [
      this.emailOpen(),
      `<p>Oi <strong>${this.escapeHtml(greetingName)}</strong>,</p>`,
      "<p>Seu resumo da semana:</p>",
      "<ul>",
      `<li>Saldo atual: <strong>${this.escapeHtml(money(input.balance))}</strong></li>`,
      `<li>Receitas do mes: ${this.escapeHtml(money(input.monthlyIncome))}</li>`,
      `<li>Despesas do mes: ${this.escapeHtml(money(input.monthlyExpenses))}</li>`,
      `<li>${this.escapeHtml(overdueLine)}</li>`,
      "</ul>",
      goalLines.length
        ? `<p>Metas em andamento:</p><ul>${goalLines.map((line) => `<li>${this.escapeHtml(line)}</li>`).join("")}</ul>`
        : "",
      "<p>Abra o LUMEN para o detalhe completo.</p>",
      "<p>Equipe LUMEN</p>",
      this.footerHtml(input.unsubscribe),
      "</body></html>",
    ].join("");

    return this.sendEmail({
      to: input.email,
      subject,
      text,
      html,
      tags: ["weekly_digest"],
      headers: this.unsubscribeHeaders(input.unsubscribe),
    });
  }

  async sendMfaBypassEmail(input: MfaBypassEmailInput) {
    const greetingName = input.name ? this.firstName(input.name) : "voce";
    const subject = "LUMEN: codigo de acesso temporario";
    const text = [
      `Oi ${greetingName},`,
      "",
      "Recebemos uma solicitacao para acessar sua conta sem o autenticador.",
      "",
      `Seu codigo de acesso temporario e: ${input.otp}`,
      "",
      "Este codigo expira em 10 minutos e so pode ser usado uma vez.",
      "Se nao foi voce, ignore este email.",
      "",
      "Equipe LUMEN",
    ].join("\n");
    const html = [
      this.emailOpen(),
      `<p>Oi <strong>${this.escapeHtml(greetingName)}</strong>,</p>`,
      "<p>Recebemos uma solicitacao para acessar sua conta sem o autenticador.</p>",
      `<p>Seu codigo de acesso temporario e: <strong style="font-size: 1.4rem; letter-spacing: 0.15em;">${this.escapeHtml(input.otp)}</strong></p>`,
      "<p>Este codigo expira em <strong>10 minutos</strong> e so pode ser usado uma vez.</p>",
      "<p style='color:#6b7280;font-size:0.875rem;'>Se nao foi voce, ignore este email.</p>",
      "<p>Equipe LUMEN</p>",
      "</body></html>",
    ].join("");

    return this.sendEmail({
      to: input.email,
      subject,
      text,
      html,
      tags: ["mfa_bypass", "auth"],
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
    const headers: Record<string, string> = {
      ...(replyTo ? { "Reply-To": replyTo } : {}),
      ...(options.headers ?? {}),
    };
    if (Object.keys(headers).length > 0) {
      payload.headers = headers;
    }

    const tags = this.buildTags(options.tags ?? []);
    if (tags.length > 0) {
      payload.tags = tags;
    }

    return payload;
  }

  private unsubscribeHeaders(links?: UnsubscribeLinks) {
    if (!links) {
      return undefined;
    }

    return {
      "List-Unsubscribe": `<${links.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  private footerText(links?: UnsubscribeLinks) {
    return links
      ? `\n\nNao quer mais receber este tipo de email? Deixe de receber aqui: ${links.pageUrl}`
      : "";
  }

  private footerHtml(links?: UnsubscribeLinks) {
    return links
      ? `<p style="color:#6b7280;font-size:0.8125rem;">Nao quer mais receber este tipo de email? <a href="${this.escapeHtml(links.pageUrl)}">Deixar de receber</a>.</p>`
      : "";
  }

  /** Abertura comum dos emails: corpo + cabecalho com o icone e o nome do LUMEN. */
  private emailOpen() {
    const frontendUrl =
      this.configService.get<string>("app.frontendUrl") ??
      "http://localhost:4200";
    const logoUrl = this.escapeHtml(
      `${frontendUrl}/assets/logo/logo_lumen_1024.png`,
    );

    return [
      '<html><body style="font-family: Arial, sans-serif; color: #1f2937;">',
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;"><tr>',
      `<td style="padding-right:10px;"><img src="${logoUrl}" width="40" height="40" alt="LUMEN" style="display:block;border:0;border-radius:8px;" /></td>`,
      '<td style="font-size:20px;font-weight:700;letter-spacing:0.08em;color:#0f2229;">LUMEN</td>',
      "</tr></table>",
    ].join("");
  }

  private actionButton(url: string, label: string) {
    return `<p><a href="${this.escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#006cd2;color:#ffffff;text-decoration:none;font-weight:600;">${this.escapeHtml(label)}</a></p><p style="color:#6b7280;font-size:0.8125rem;">Se o botao nao funcionar, copie este endereco no navegador:<br />${this.escapeHtml(url)}</p>`;
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
