import { EmailContext, EmailVerificationInput, SendEmailOptions } from "../mail.types";
import { greetingName } from "./email-formatting";
import { actionButton, emailOpen, escapeHtml } from "./email-layout";

export function buildEmailVerificationEmail(input: EmailVerificationInput, ctx: EmailContext): SendEmailOptions {
  const name = greetingName(input.name);
  const text = [
    `Oi ${name},`,
    "",
    "Confirme seu email para receber lembretes e resumos do LUMEN:",
    input.verifyUrl,
    "",
    `Este link expira em ${input.expiresInHours} horas.`,
    "Se voce nao criou uma conta no LUMEN, ignore este email.",
    "Equipe LUMEN",
  ].join("\n");
  const html = [
    emailOpen(ctx.frontendUrl),
    `<p>Oi <strong>${escapeHtml(name)}</strong>,</p>`,
    "<p>Confirme seu email para receber lembretes e resumos do <strong>LUMEN</strong>:</p>",
    actionButton(input.verifyUrl, "Confirmar email"),
    `<p>Este link expira em <strong>${input.expiresInHours} horas</strong>.</p>`,
    "<p style='color:#6b7280;font-size:0.875rem;'>Se voce nao criou uma conta no LUMEN, ignore este email.</p>",
    "<p>Equipe LUMEN</p>",
    "</body></html>",
  ].join("");

  return { to: input.email, subject: "LUMEN: confirme seu email", text, html, tags: ["email_verification", "auth"] };
}
