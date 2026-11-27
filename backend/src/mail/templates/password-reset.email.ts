import { EmailContext, PasswordResetEmailInput, SendEmailOptions } from "../mail.types";
import { greetingName } from "./email-formatting";
import { actionButton, emailOpen, escapeHtml } from "./email-layout";

export function buildPasswordResetEmail(input: PasswordResetEmailInput, ctx: EmailContext): SendEmailOptions {
  const name = greetingName(input.name);
  const text = [
    `Oi ${name},`,
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
    emailOpen(ctx.frontendUrl),
    `<p>Oi <strong>${escapeHtml(name)}</strong>,</p>`,
    "<p>Recebemos um pedido para redefinir a senha da sua conta no <strong>LUMEN</strong>.</p>",
    actionButton(input.resetUrl, "Criar nova senha"),
    `<p>Este link expira em <strong>${input.expiresInMinutes} minutos</strong> e so pode ser usado uma vez.</p>`,
    "<p style='color:#6b7280;font-size:0.875rem;'>Se nao foi voce, ignore este email — sua senha continua a mesma.</p>",
    "<p>Equipe LUMEN</p>",
    "</body></html>",
  ].join("");

  return { to: input.email, subject: "LUMEN: redefinir sua senha", text, html, tags: ["password_reset", "auth"] };
}
