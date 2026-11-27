import { EmailContext, PasswordChangedEmailInput, SendEmailOptions } from "../mail.types";
import { greetingName } from "./email-formatting";
import { emailOpen, escapeHtml } from "./email-layout";

export function buildPasswordChangedEmail(input: PasswordChangedEmailInput, ctx: EmailContext): SendEmailOptions {
  const name = greetingName(input.name);
  const text = [
    `Oi ${name},`,
    "",
    "A senha da sua conta no LUMEN acabou de ser alterada e todas as sessoes abertas foram encerradas.",
    "Se nao foi voce, redefina a senha de novo e entre em contato com a gente.",
    "Equipe LUMEN",
  ].join("\n");
  const html = [
    emailOpen(ctx.frontendUrl),
    `<p>Oi <strong>${escapeHtml(name)}</strong>,</p>`,
    "<p>A senha da sua conta no <strong>LUMEN</strong> acabou de ser alterada e todas as sessoes abertas foram encerradas.</p>",
    "<p style='color:#6b7280;font-size:0.875rem;'>Se nao foi voce, redefina a senha de novo e entre em contato com a gente.</p>",
    "<p>Equipe LUMEN</p>",
    "</body></html>",
  ].join("");

  return { to: input.email, subject: "LUMEN: sua senha foi alterada", text, html, tags: ["password_changed", "auth"] };
}
