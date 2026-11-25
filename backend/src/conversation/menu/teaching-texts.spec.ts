import { RECEIPT_TIMEOUT_MESSAGE, RECEIPT_UNREADABLE_MESSAGE } from '../../imports/receipt-extractor.types';
import { TELEGRAM_TEXTS } from '../../telegram/telegram-adapter.service';
import { WHATSAPP_TEXTS } from '../../whatsapp/whatsapp-adapter.service';
import { matchIntent } from '../parsers/intent.matcher';
import { REPLIES } from '../replies';

const TEACHING_TEXTS: Array<[string, string]> = [
  ['boas-vindas do Telegram', TELEGRAM_TEXTS.linked],
  ['texto vazio do Telegram', TELEGRAM_TEXTS.empty],
  ['boas-vindas do WhatsApp', WHATSAPP_TEXTS.linked],
  ['texto vazio do WhatsApp', WHATSAPP_TEXTS.empty],
  ['nota ilegivel', RECEIPT_UNREADABLE_MESSAGE],
  ['nota demorou', RECEIPT_TIMEOUT_MESSAGE],
  ['ajuda', REPLIES.help],
  ['valor ausente', REPLIES.amountMissing],
  ['IA bloqueada', REPLIES.aiFallbackBlocked],
  ['IA indisponivel', REPLIES.aiFallbackUnavailable],
  ['IA sem resposta', REPLIES.aiFallbackHelp],
];

describe('textos que ensinam frases', () => {
  it.each(TEACHING_TEXTS)('%s: nao ensina "50 mercado" e cada exemplo entre aspas casa no matcher', (_name, text) => {
    expect(text).not.toContain('"50 mercado"');
    // "menu" e palavra de controle do motor, tratada antes do matcher.
    const examples = [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1]).filter((example) => example !== 'menu');
    for (const example of examples) {
      expect({ example, intent: matchIntent(example)?.intent ?? null }).toEqual({ example, intent: expect.any(String) });
    }
  });

  it.each([
    ['Telegram', TELEGRAM_TEXTS.linked],
    ['WhatsApp', WHATSAPP_TEXTS.linked],
    ['nota ilegivel', RECEIPT_UNREADABLE_MESSAGE],
  ])('%s ensina a forma natural de despesa', (_name, text) => {
    expect(text).toContain('"gastei 50 no mercado"');
  });
});
