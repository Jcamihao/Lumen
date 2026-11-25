import { ConversationReply } from '../conversation/conversation.types';

/**
 * Formato da resposta do motor para o Telegram (contrato 10, D4). HTML com escape total: o texto do
 * motor nunca e markup, entao &lt;, &gt; e &amp; viram entidades e nada vira tag. Teclado so no
 * rascunho a confirmar; em HELP os exemplos vao no texto, como no WhatsApp.
 */
export const MAX_PART_CHARS = 3500;
export const MAX_PARTS = 4;
const MOTOR_CONFIRM_PROMPT = 'Responda "confirmar" ou "cancelar".';
const ELLIPSIS = '…';

export interface FormattedReply {
  parts: string[];
  /** Botoes de resposta (D4): presentes so no rascunho esperando confirmacao; anexados a ultima parte. */
  keyboard?: string[];
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatReplyForTelegram(reply: ConversationReply): FormattedReply {
  const lines: string[] = [escapeHtml(reply.text)];

  // O texto do motor ja pode ser o cartao completo: repetir as linhas duplicaria o bloco.
  const textIsCompleteCard = reply.kind === 'CONFIRM_DRAFT' && reply.text.includes(MOTOR_CONFIRM_PROMPT);

  if (reply.draft && !textIsCompleteCard) {
    for (const row of reply.draft.rows) {
      lines.push(`<b>${escapeHtml(row.label)}:</b> ${escapeHtml(row.value)}`);
    }
  }

  if (reply.kind === 'HELP' && reply.quickReplies && reply.quickReplies.length > 0) {
    lines.push(`Exemplos: ${reply.quickReplies.map((example) => escapeHtml(example)).join(' | ')}`);
  }

  const keyboard = reply.kind === 'CONFIRM_DRAFT' && reply.quickReplies && reply.quickReplies.length > 0
    ? reply.quickReplies.map((label) => escapeHtml(label))
    : undefined;

  return { parts: splitIntoParts(lines.join('\n')), ...(keyboard ? { keyboard } : {}) };
}

/** Corta em partes de ate MAX_PART_CHARS, preferindo quebra de linha. Excedente vira "…" no fim da ultima. */
export function splitIntoParts(text: string): string[] {
  const parts: string[] = [];
  let rest = text;

  while (rest.length > 0 && parts.length < MAX_PARTS) {
    if (rest.length <= MAX_PART_CHARS) {
      parts.push(rest);
      rest = '';
      break;
    }
    const window = rest.slice(0, MAX_PART_CHARS);
    const newline = window.lastIndexOf('\n');
    const cut = newline > 0 ? newline : MAX_PART_CHARS;
    parts.push(rest.slice(0, cut).replace(/\s+$/, ''));
    rest = rest.slice(cut).replace(/^\n/, '');
  }

  if (rest.length > 0) {
    const last = parts.length - 1;
    const room = MAX_PART_CHARS - ELLIPSIS.length;
    parts[last] = parts[last].slice(0, room) + ELLIPSIS;
  }

  return parts;
}
