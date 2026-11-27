import { EmailContext, MfaBypassEmailInput, SendEmailOptions } from "../mail.types";
import { greetingName } from "./email-formatting";
import { emailOpen, escapeHtml } from "./email-layout";

export function buildMfaBypassEmail(input: MfaBypassEmailInput, ctx: EmailContext): SendEmailOptions {
  const name = greetingName(input.name);
  const text = [
    `Oi ${name},`,
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
    emailOpen(ctx.frontendUrl),
    `<p>Oi <strong>${escapeHtml(name)}</strong>,</p>`,
    "<p>Recebemos uma solicitacao para acessar sua conta sem o autenticador.</p>",
    `<p>Seu codigo de acesso temporario e: <strong style="font-size: 1.4rem; letter-spacing: 0.15em;">${escapeHtml(input.otp)}</strong></p>`,
    "<p>Este codigo expira em <strong>10 minutos</strong> e so pode ser usado uma vez.</p>",
    "<p style='color:#6b7280;font-size:0.875rem;'>Se nao foi voce, ignore este email.</p>",
    "<p>Equipe LUMEN</p>",
    "</body></html>",
  ].join("");

  return { to: input.email, subject: "LUMEN: codigo de acesso temporario", text, html, tags: ["mfa_bypass", "auth"] };
}
