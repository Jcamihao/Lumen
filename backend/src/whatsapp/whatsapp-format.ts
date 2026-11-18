import { ConversationReply } from '../conversation/conversation.types';

export const MAX_PART_CHARS = 1000;
export const MAX_PARTS = 3;
const CONFIRM_LINE = 'Responda *confirmar* para gravar ou *cancelar* para descartar.';
const ELLIPSIS = '…';

/** Texto do motor em partes para o WhatsApp (contrato secao 10). Nunca inclui ids internos. */
export function formatReplyForWhatsapp(reply: ConversationReply): string[] {
  const lines: string[] = [reply.text];

  if (reply.draft) {
    for (const row of reply.draft.rows) {
      lines.push(`*${row.label}:* ${row.value}`);
    }
    if (reply.kind === 'CONFIRM_DRAFT') {
      lines.push(CONFIRM_LINE);
    }
  }

  if (reply.kind === 'HELP' && reply.quickReplies && reply.quickReplies.length > 0) {
    lines.push(`Exemplos: ${reply.quickReplies.join(' | ')}`);
  }

  return splitIntoParts(lines.join('\n'));
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
