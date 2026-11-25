import { ConversationReply } from '../conversation/conversation.types';
import { MenuView } from '../conversation/menu/menu.types';
import { MENU_BUTTON_LABEL, TelegramInlineButton, TelegramMarkup } from './telegram-bot.client';

/**
 * Formato da resposta do motor para o Telegram (contrato 10, D4). HTML com escape total: o texto do
 * motor nunca e markup, entao &lt;, &gt; e &amp; viram entidades e nada vira tag. Cada resposta leva um
 * teclado: Confirmar/Cancelar no rascunho, o menu inline no kind MENU e o botao fixo "Menu" no resto.
 */
export const MAX_PART_CHARS = 3500;
export const MAX_PARTS = 4;
const MOTOR_CONFIRM_PROMPT = 'Responda "confirmar" ou "cancelar".';
const ELLIPSIS = '…';

const MENU_CALLBACK_PREFIX = 'm:';
const CALLBACK_MAX_BYTES = 64;
const KEYBOARD_MAX_BUTTONS = 100;
const CALLBACK_PATTERN = /^m:([a-z0-9_:.-]{1,40})$/;
const BACK_LABEL = 'Voltar';

/** Botao fixo de resposta "Menu": vai em todo texto ao vinculado que nao seja Confirmar/Cancelar. */
export const FIXED_MENU_MARKUP: TelegramMarkup = { kind: 'menu' };

export interface FormattedReply {
  parts: string[];
  markup: TelegramMarkup;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatReplyForTelegram(reply: ConversationReply): FormattedReply {
  return { parts: splitIntoParts(bodyLines(reply).join('\n')), markup: markupOf(reply) };
}

/** Dado do clique: "m:<nodeId>". Formato fora do padrao = null (o adaptador ignora). */
export function nodeIdFromCallback(data: string): string | null {
  const match = CALLBACK_PATTERN.exec(data);
  return match ? match[1] : null;
}

/** Teclado inline do menu: uma opcao por linha; em submenu, a ultima linha tem Voltar e Menu. */
export function menuRows(view: MenuView): TelegramInlineButton[][] {
  const navigation: TelegramInlineButton[] = [];
  if (view.backId) navigation.push(menuButton(BACK_LABEL, view.backId));
  if (view.topId) navigation.push(menuButton(MENU_BUTTON_LABEL, view.topId));

  const room = KEYBOARD_MAX_BUTTONS - navigation.length;
  const options = view.options
    .filter((option) => callbackFits(option.id))
    .slice(0, room)
    .map((option) => [menuButton(option.label, option.id)]);
  return navigation.length > 0 ? [...options, navigation] : options;
}

function bodyLines(reply: ConversationReply): string[] {
  if (reply.menu) return [escapeHtml(menuCaption(reply.menu))];
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
  return lines;
}

/** Com botoes, o texto e so o titulo (e o aviso antes dele): a lista numerada e para canal sem botao. */
function menuCaption(menu: MenuView): string {
  return menu.lead ? `${menu.lead}\n\n${menu.title}` : menu.title;
}

function markupOf(reply: ConversationReply): TelegramMarkup {
  if (reply.kind === 'CONFIRM_DRAFT' && reply.quickReplies && reply.quickReplies.length > 0) {
    return { kind: 'confirm', labels: reply.quickReplies.map((label) => escapeHtml(label)) };
  }
  if (reply.menu) return { kind: 'inline', rows: menuRows(reply.menu) };
  return FIXED_MENU_MARKUP;
}

function menuButton(label: string, nodeId: string): TelegramInlineButton {
  return { text: label, callback_data: `${MENU_CALLBACK_PREFIX}${nodeId}` };
}

/** Limite do Telegram: callback_data de ate 64 bytes. O id ja vem curto da arvore; o corte e defesa. */
function callbackFits(nodeId: string): boolean {
  return Buffer.byteLength(`${MENU_CALLBACK_PREFIX}${nodeId}`, 'utf8') <= CALLBACK_MAX_BYTES;
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
