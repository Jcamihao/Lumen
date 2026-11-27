import { EmailContext, SendEmailOptions, WeeklyDigestEmailInput } from "../mail.types";
import { greetingName } from "./email-formatting";
import { emailOpen, escapeHtml, footerHtml, footerText, unsubscribeHeaders } from "./email-layout";

type Goal = WeeklyDigestEmailInput["goals"][number];
const MAX_GOALS = 3;

// Sem fallback para moeda invalida (diferente do aviso de contas): o resumo falha no envio.
const moneyFormatter = (currency: string) => (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(value);

function goalLine(goal: Goal, money: (value: number) => string): string {
  if (goal.targetAmount === null) {
    return `${goal.title}: ${money(goal.currentAmount)} guardados (sem alvo definido)`;
  }
  const pct =
    goal.targetAmount > 0 ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)) : 0;
  return `${goal.title}: ${pct}% (${money(goal.currentAmount)} de ${money(goal.targetAmount)})`;
}

type DigestData = {
  name: string;
  money: (value: number) => string;
  overdueLine: string;
  goalLines: string[];
};

function digestText(input: WeeklyDigestEmailInput, d: DigestData): string {
  return (
    [
      `Oi ${d.name},`,
      "",
      "Seu resumo da semana:",
      `- Saldo atual: ${d.money(input.balance)}`,
      `- Receitas do mes: ${d.money(input.monthlyIncome)}`,
      `- Despesas do mes: ${d.money(input.monthlyExpenses)}`,
      `- ${d.overdueLine}`,
      ...(d.goalLines.length ? ["", "Metas em andamento:", ...d.goalLines.map((line) => `- ${line}`)] : []),
      "",
      "Abra o LUMEN para o detalhe completo.",
      "Equipe LUMEN",
    ].join("\n") + footerText(input.unsubscribe)
  );
}

function digestHtml(input: WeeklyDigestEmailInput, d: DigestData, ctx: EmailContext): string {
  return [
    emailOpen(ctx.frontendUrl),
    `<p>Oi <strong>${escapeHtml(d.name)}</strong>,</p>`,
    "<p>Seu resumo da semana:</p>",
    "<ul>",
    `<li>Saldo atual: <strong>${escapeHtml(d.money(input.balance))}</strong></li>`,
    `<li>Receitas do mes: ${escapeHtml(d.money(input.monthlyIncome))}</li>`,
    `<li>Despesas do mes: ${escapeHtml(d.money(input.monthlyExpenses))}</li>`,
    `<li>${escapeHtml(d.overdueLine)}</li>`,
    "</ul>",
    d.goalLines.length
      ? `<p>Metas em andamento:</p><ul>${d.goalLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
      : "",
    "<p>Abra o LUMEN para o detalhe completo.</p>",
    "<p>Equipe LUMEN</p>",
    footerHtml(input.unsubscribe),
    "</body></html>",
  ].join("");
}

/** Resumo semanal — cadencia separada do pulso diario, panorama da semana. */
export function buildWeeklyDigestEmail(input: WeeklyDigestEmailInput, ctx: EmailContext): SendEmailOptions {
  const money = moneyFormatter(input.preferredCurrency);
  const data: DigestData = {
    name: greetingName(input.name),
    money,
    overdueLine:
      input.overdueTasksCount > 0 ? `${input.overdueTasksCount} tarefa(s) atrasada(s).` : "Nenhuma tarefa atrasada.",
    goalLines: input.goals.slice(0, MAX_GOALS).map((goal) => goalLine(goal, money)),
  };

  return {
    to: input.email,
    subject: "LUMEN: seu resumo da semana",
    text: digestText(input, data),
    html: digestHtml(input, data, ctx),
    tags: ["weekly_digest"],
    headers: unsubscribeHeaders(input.unsubscribe),
  };
}
