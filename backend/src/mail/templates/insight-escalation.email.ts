import { EmailContext, InsightEscalationEmailInput, SendEmailOptions } from "../mail.types";
import { greetingName } from "./email-formatting";
import { emailOpen, escapeHtml, footerHtml, footerText, unsubscribeHeaders } from "./email-layout";

function escalationText(input: InsightEscalationEmailInput, name: string): string {
  return (
    [
      `Oi ${name},`,
      "",
      `Isso ainda esta pendente: ${input.message}`,
      "",
      "Ja avisamos isso dentro do app ha alguns dias e continua sem resolucao.",
      "Abra o LUMEN quando puder dar uma olhada.",
      "Equipe LUMEN",
    ].join("\n") + footerText(input.unsubscribe)
  );
}

function escalationHtml(input: InsightEscalationEmailInput, name: string, ctx: EmailContext): string {
  return [
    emailOpen(ctx.frontendUrl),
    `<p>Oi <strong>${escapeHtml(name)}</strong>,</p>`,
    `<p>Isso ainda esta pendente: <strong>${escapeHtml(input.message)}</strong></p>`,
    "<p>Ja avisamos isso dentro do app ha alguns dias e continua sem resolucao.</p>",
    "<p>Abra o LUMEN quando puder dar uma olhada.</p>",
    "<p>Equipe LUMEN</p>",
    footerHtml(input.unsubscribe),
    "</body></html>",
  ].join("");
}

export function buildInsightEscalationEmail(input: InsightEscalationEmailInput, ctx: EmailContext): SendEmailOptions {
  const name = greetingName(input.name);

  return {
    to: input.email,
    subject: "LUMEN: um alerta continua sem resolucao",
    text: escalationText(input, name),
    html: escalationHtml(input, name, ctx),
    tags: ["insight_escalation"],
    headers: unsubscribeHeaders(input.unsubscribe),
  };
}
