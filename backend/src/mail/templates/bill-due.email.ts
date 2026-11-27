import { BillDueEmailInput, EmailContext, SendEmailOptions } from "../mail.types";
import { formatMoney, greetingName } from "./email-formatting";
import { emailOpen, escapeHtml, footerHtml, footerText, unsubscribeHeaders } from "./email-layout";

type Bill = BillDueEmailInput["bills"][number];

const when = (daysUntil: number): string => (daysUntil === 1 ? "amanha" : `em ${daysUntil} dias`);

// dueDate e "so dia" (meia-noite UTC): formatar em UTC, senao no fuso do Brasil vira o dia anterior.
const dayMonth = (date: Date): string =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(date);

function billLine(bill: Bill, currency: string): string {
  return `${bill.description} — ${formatMoney(bill.amount, currency)} — vence ${dayMonth(bill.dueDate)} (${when(bill.daysUntil)})`;
}

function billSubject(bills: Bill[]): string {
  return bills.length === 1
    ? `LUMEN: "${bills[0].description}" vence ${when(bills[0].daysUntil)}`
    : `LUMEN: ${bills.length} contas vencem nos proximos dias`;
}

/**
 * Aviso de conta(s) fixa(s) perto de vencer — um e-mail por usuario com
 * todas as contas da janela.
 */
export function buildBillDueEmail(input: BillDueEmailInput, ctx: EmailContext): SendEmailOptions {
  const name = greetingName(input.name);
  const lines = input.bills.map((bill) => billLine(bill, input.preferredCurrency));
  const total = formatMoney(input.bills.reduce((sum, bill) => sum + bill.amount, 0), input.preferredCurrency);
  const intro = input.bills.length === 1 ? "Uma conta sua vence em breve:" : "Estas contas vencem em breve:";

  const text =
    [`Oi ${name},`, "", intro, ...lines.map((line) => `- ${line}`), "", `Total: ${total}`, "", "Abra o LUMEN para conferir.", "Equipe LUMEN"].join("\n") +
    footerText(input.unsubscribe);
  const html = [
    emailOpen(ctx.frontendUrl),
    `<p>Oi <strong>${escapeHtml(name)}</strong>,</p>`,
    `<p>${intro}</p>`,
    `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
    `<p>Total: <strong>${escapeHtml(total)}</strong></p>`,
    "<p>Abra o LUMEN para conferir.</p>",
    "<p>Equipe LUMEN</p>",
    footerHtml(input.unsubscribe),
    "</body></html>",
  ].join("");

  return { to: input.email, subject: billSubject(input.bills), text, html, tags: ["bill_due"], headers: unsubscribeHeaders(input.unsubscribe) };
}
