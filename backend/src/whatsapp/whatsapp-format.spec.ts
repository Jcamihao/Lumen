import { ConversationReply } from '../conversation/conversation.types';
import { MAX_PART_CHARS, formatReplyForWhatsapp, splitIntoParts } from './whatsapp-format';

const base = (over: Partial<ConversationReply>): ConversationReply => ({ kind: 'INFO', state: 'IDLE', text: 'Oi', ...over } as ConversationReply);

describe('formatReplyForWhatsapp', () => {
  it('CONFIRM_DRAFT acrescenta linhas do rascunho e a linha de confirmar', () => {
    const [text] = formatReplyForWhatsapp(
      base({
        kind: 'CONFIRM_DRAFT',
        text: 'Confira:',
        draft: { draftId: 'd1', draftVersion: 1, kind: 'TRANSACTION', title: 'Lançamento', rows: [{ label: 'Valor', value: 'R$ 50,00' }] } as never,
      }),
    );
    expect(text).toContain('*Valor:* R$ 50,00');
    expect(text).toContain('Responda *confirmar* para gravar ou *cancelar* para descartar.');
  });

  it('INFO com rascunho nao ganha a linha de confirmar', () => {
    const [text] = formatReplyForWhatsapp(
      base({ kind: 'INFO', draft: { draftId: 'd1', draftVersion: 1, kind: 'TRANSACTION', title: 'x', rows: [{ label: 'Valor', value: 'R$ 1,00' }] } as never }),
    );
    expect(text).toContain('*Valor:* R$ 1,00');
    expect(text).not.toContain('confirmar');
  });

  it('quickReplies so entram em HELP', () => {
    const [helpText] = formatReplyForWhatsapp(base({ kind: 'HELP', quickReplies: ['saldo', 'reservas'] } as never));
    expect(helpText).toContain('Exemplos: saldo | reservas');
    const [infoText] = formatReplyForWhatsapp(base({ kind: 'INFO', quickReplies: ['saldo'] } as never));
    expect(infoText).not.toContain('Exemplos');
  });

  it('nunca inclui draftId nem draftVersion', () => {
    const parts = formatReplyForWhatsapp(
      base({ kind: 'CONFIRM_DRAFT', draft: { draftId: 'ID-SECRETO-123', draftVersion: 7, kind: 'TRANSACTION', title: 'x', rows: [] } as never }),
    );
    expect(parts.join('')).not.toContain('ID-SECRETO-123');
    expect(parts.join('')).not.toContain('draftVersion');
  });
});

describe('splitIntoParts', () => {
  it('texto de 2500 caracteres vira 3 partes sem reticencias', () => {
    const parts = splitIntoParts('a'.repeat(2500));
    expect(parts).toHaveLength(3);
    expect(parts.every((part) => part.length <= MAX_PART_CHARS)).toBe(true);
    expect(parts.join('')).toBe('a'.repeat(2500));
  });

  it('texto de 4000 caracteres sem quebra vira 3 partes e o excedente sai com reticencias', () => {
    const parts = splitIntoParts('b'.repeat(4000));
    expect(parts).toHaveLength(3);
    expect(parts.every((part) => part.length <= MAX_PART_CHARS)).toBe(true);
    expect(parts[2].endsWith('…')).toBe(true);
  });

  it('prefere quebrar em \\n', () => {
    const line = 'c'.repeat(600);
    const parts = splitIntoParts(`${line}\n${line}\n${line}`);
    expect(parts[0]).toBe(line);
    expect(parts[1]).toBe(line);
  });

  it('texto curto fica em uma parte', () => {
    expect(splitIntoParts('oi')).toEqual(['oi']);
  });
});
