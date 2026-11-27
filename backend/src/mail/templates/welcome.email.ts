import { EmailContext, SendEmailOptions, WelcomeEmailInput } from "../mail.types";
import { greetingName } from "./email-formatting";
import { actionButton, emailOpen, escapeHtml } from "./email-layout";

export function buildWelcomeEmail(input: WelcomeEmailInput, ctx: EmailContext): SendEmailOptions {
  const name = greetingName(input.name);
  const text = [
    `Oi ${name},`,
    "",
    "Sua conta no LUMEN foi criada com sucesso.",
    input.verifyUrl ? `Confirme seu email para receber lembretes e resumos: ${input.verifyUrl}` : null,
    `Voce ja pode acessar sua area em ${ctx.frontendUrl}.`,
    "",
    "Obrigado por construir sua clareza com a gente.",
    "Equipe LUMEN",
  ]
    .filter((line) => line !== null)
    .join("\n");
  const html = [
    emailOpen(ctx.frontendUrl),
    `<p>Oi <strong>${escapeHtml(name)}</strong>,</p>`,
    "<p>Sua conta no <strong>LUMEN</strong> foi criada com sucesso.</p>",
    input.verifyUrl
      ? `<p>Confirme seu email para receber lembretes e resumos:</p>${actionButton(input.verifyUrl, "Confirmar email")}`
      : "",
    `<p>Voce ja pode acessar sua area em <a href="${escapeHtml(ctx.frontendUrl)}">${escapeHtml(ctx.frontendUrl)}</a>.</p>`,
    "<p>Obrigado por construir sua clareza com a gente.<br />Equipe LUMEN</p>",
    "</body></html>",
  ].join("");

  return { to: input.email, subject: "Sua conta no LUMEN esta pronta", text, html, tags: ["welcome", "auth"] };
}
