import { UnsubscribeLinks } from "../mail.types";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Abertura comum dos emails: corpo + cabecalho com o icone e o nome do LUMEN. */
export function emailOpen(frontendUrl: string): string {
  const logoUrl = escapeHtml(`${frontendUrl}/assets/logo/logo_lumen_1024.png`);

  return [
    '<html><body style="font-family: Arial, sans-serif; color: #1f2937;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;"><tr>',
    `<td style="padding-right:10px;"><img src="${logoUrl}" width="40" height="40" alt="LUMEN" style="display:block;border:0;border-radius:8px;" /></td>`,
    '<td style="font-size:20px;font-weight:700;letter-spacing:0.08em;color:#0f2229;">LUMEN</td>',
    "</tr></table>",
  ].join("");
}

export function actionButton(url: string, label: string): string {
  return `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#006cd2;color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a></p><p style="color:#6b7280;font-size:0.8125rem;">Se o botao nao funcionar, copie este endereco no navegador:<br />${escapeHtml(url)}</p>`;
}

export function footerHtml(links?: UnsubscribeLinks): string {
  return links
    ? `<p style="color:#6b7280;font-size:0.8125rem;">Nao quer mais receber este tipo de email? <a href="${escapeHtml(links.pageUrl)}">Deixar de receber</a>.</p>`
    : "";
}

export function footerText(links?: UnsubscribeLinks): string {
  return links
    ? `\n\nNao quer mais receber este tipo de email? Deixe de receber aqui: ${links.pageUrl}`
    : "";
}

export function unsubscribeHeaders(links?: UnsubscribeLinks): Record<string, string> | undefined {
  if (!links) return undefined;
  return {
    "List-Unsubscribe": `<${links.oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
