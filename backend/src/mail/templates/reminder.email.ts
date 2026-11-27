import { EmailContext, ReminderEmailInput, SendEmailOptions } from "../mail.types";
import { formatDateTime, greetingName } from "./email-formatting";
import { emailOpen, escapeHtml, footerHtml, footerText, unsubscribeHeaders } from "./email-layout";

function reminderText(input: ReminderEmailInput, name: string, formattedDate: string): string {
  const contextLine = input.contextTitle ? `Contexto relacionado: ${input.contextTitle}.` : null;
  return (
    [
      `Oi ${name},`,
      "",
      `Seu lembrete "${input.title}" foi disparado em ${formattedDate}.`,
      contextLine,
      "",
      "Abra o LUMEN para revisar os proximos passos.",
      "Equipe LUMEN",
    ]
      .filter(Boolean)
      .join("\n") + footerText(input.unsubscribe)
  );
}

function reminderHtml(input: ReminderEmailInput, name: string, formattedDate: string, ctx: EmailContext): string {
  return [
    emailOpen(ctx.frontendUrl),
    `<p>Oi <strong>${escapeHtml(name)}</strong>,</p>`,
    `<p>Seu lembrete <strong>${escapeHtml(input.title)}</strong> foi disparado em ${escapeHtml(formattedDate)}.</p>`,
    input.contextTitle ? `<p>Contexto relacionado: ${escapeHtml(input.contextTitle)}.</p>` : "",
    "<p>Abra o LUMEN para revisar os proximos passos.</p>",
    "<p>Equipe LUMEN</p>",
    footerHtml(input.unsubscribe),
    "</body></html>",
  ].join("");
}

export function buildReminderEmail(input: ReminderEmailInput, ctx: EmailContext): SendEmailOptions {
  const name = greetingName(input.name);
  const formattedDate = formatDateTime(input.remindAt, input.timezone);

  return {
    to: input.email,
    subject: `LUMEN: lembrete - ${input.title}`,
    text: reminderText(input, name, formattedDate),
    html: reminderHtml(input, name, formattedDate, ctx),
    tags: ["reminder"],
    headers: unsubscribeHeaders(input.unsubscribe),
  };
}
