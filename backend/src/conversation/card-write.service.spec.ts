import { ConversationChannel } from '@prisma/client';
import { CreditCardWriteUncertainError } from '../credit-cards/credit-cards.service';
import { CARD_WRITE_REPLIES } from './card-write';
import { CL_REPLIES } from './credit-limit';
import { CARD_READ_REPLIES } from './card-read';
import { REPLIES } from './replies';
import { Engine, T0, USER_ID, World, buildEngine, seedWorld } from './isolation.fixture';

/**
 * Renomear e criar cartao pela conversa (9b-3). Motor real sobre o mundo fake; o CreditCardsService e o real
 * (nome unico, cartao ativo, lock), so o Prisma por baixo e fake. Criar cartao e recusado (ver resultado-9b3.md).
 */
type Who = 'A' | 'B' | 'C';

let world: World;
let engine: Engine;
let counter = 0;

beforeEach(() => {
  world = seedWorld();
  engine = buildEngine(world, true);
  counter = 0;
});

function say(who: Who, text: string, channel: ConversationChannel = 'APP' as ConversationChannel, at: Date = T0) {
  counter += 1;
  return engine.service.handleMessage({ userId: USER_ID[who], channel, messageId: `m-${counter}`, text, receivedAt: at });
}

const cardRow = (id: string) => world.cards.find((card) => card.id === id);
const namesOf = (who: Who) => world.cards.filter((card) => card.userId === USER_ID[who]).map((card) => card.name);
const updateSpy = () => (world.services.creditCards as unknown as { update: jest.Mock }).update;
const LATER = new Date(T0.getTime() + 2 * 24 * 60 * 60 * 1000);

describe('Renomear cartao pela conversa (9b-3)', () => {
  it('rascunho com resumo e confirmacao; confirmar grava pelo CreditCardsService e responde com o recibo', async () => {
    const draft = await say('A', 'renomear cartao Nubank para Roxinho');
    expect(draft.kind).toBe('CONFIRM_DRAFT');
    expect(draft.state).toBe('AWAITING_CONFIRMATION');
    expect(draft.draft).toMatchObject({ kind: 'CARD_RENAME', title: 'Renomear cartão' });
    expect(draft.draft?.rows).toEqual([
      { label: 'Cartão', value: 'Nubank' },
      { label: 'Novo nome', value: 'Roxinho' },
    ]);
    expect(namesOf('A')).toEqual(['Nubank']);
    expect(updateSpy()).not.toHaveBeenCalled();

    const done = await say('A', 'confirmar');
    expect(done.kind).toBe('DONE');
    expect(done.text).toBe('Cartão Nubank renomeado para Roxinho.');
    expect(done.data).toEqual({ cardId: 'cr-A-nubank' });
    expect(cardRow('cr-A-nubank')?.name).toBe('Roxinho');
    expect(updateSpy()).toHaveBeenCalledWith(USER_ID.A, 'cr-A-nubank', { name: 'Roxinho' });
  });

  it('cancelar nao grava', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho');
    const cancelled = await say('A', 'cancelar');
    expect(cancelled.kind).toBe('CANCELLED');
    expect(namesOf('A')).toEqual(['Nubank']);
    expect(updateSpy()).not.toHaveBeenCalled();
  });

  it('rascunho vencido nao grava na confirmacao', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho');
    const late = await say('A', 'confirmar', 'APP' as ConversationChannel, LATER);
    expect(late.kind).toBe('EXPIRED');
    expect(namesOf('A')).toEqual(['Nubank']);
    expect(updateSpy()).not.toHaveBeenCalled();
  });

  it('achar o cartao pelo nome sem acento e sem caixa; forma "renomear X para Y" sem a palavra cartao', async () => {
    const draft = await say('B', 'renomear itau para Azul');
    expect(draft.kind).toBe('CONFIRM_DRAFT');
    expect(draft.draft?.rows?.[0]).toEqual({ label: 'Cartão', value: 'Itaú' });
    await say('B', 'confirmar');
    expect(cardRow('cr-B-itau')?.name).toBe('Azul');
  });

  it('nome novo igual ao atual: recusa sem rascunho', async () => {
    const reply = await say('A', 'renomear cartao Nubank para Nubank');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.sameName);
    expect(reply.state).toBe('IDLE');
    expect(world.sessions).toHaveLength(0);
  });

  it('trocar so a caixa do nome e permitido (a API tambem permite)', async () => {
    const draft = await say('A', 'renomear cartao Nubank para NUBANK');
    expect(draft.kind).toBe('CONFIRM_DRAFT');
    await say('A', 'confirmar');
    expect(cardRow('cr-A-nubank')?.name).toBe('NUBANK');
  });

  it('nome novo ja usado por outro cartao ativo (sem caixa): recusa sem rascunho', async () => {
    world.cards.push({ id: 'cr-A-roxo', userId: USER_ID.A, name: 'Roxinho', isDefault: false, archivedAt: null, closingDay: 3, dueDay: null });
    const reply = await say('A', 'renomear cartao Nubank para roxinho');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.nameTaken);
    expect(world.sessions).toHaveLength(0);
  });

  it('nome novo igual a outro cartao ativo so no acento ou na pontuacao final: recusa sem rascunho (o chat nao distinguiria os dois)', async () => {
    world.cards.push({ id: 'cr-A-roxo', userId: USER_ID.A, name: 'Roxinho', isDefault: false, archivedAt: null, closingDay: 3, dueDay: null });
    for (const name of ['Róxinho', 'ROXÍNHO', 'Roxinho!']) {
      const reply = await say('A', `renomear cartao Nubank para ${name}`);
      expect(reply.kind).toBe('ERROR');
      expect(reply.text).toBe(CARD_WRITE_REPLIES.nameTaken);
    }
    expect(world.sessions).toHaveLength(0);
    expect(updateSpy()).not.toHaveBeenCalled();
  });

  it('trocar so acento do proprio cartao e permitido (o proprio cartao nao conta)', async () => {
    const draft = await say('A', 'renomear cartao Nubank para Nübank');
    expect(draft.kind).toBe('CONFIRM_DRAFT');
    await say('A', 'confirmar');
    expect(cardRow('cr-A-nubank')?.name).toBe('Nübank');
  });

  it('corrida com nome parecido (acento) entre o rascunho e a confirmacao: recusa, nada gravado', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho');
    world.cards.push({ id: 'cr-A-roxo', userId: USER_ID.A, name: 'Róxinho', isDefault: false, archivedAt: null, closingDay: 3, dueDay: null });
    const reply = await say('A', 'confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.nameTaken);
    expect(cardRow('cr-A-nubank')?.name).toBe('Nubank');
    expect(updateSpy()).not.toHaveBeenCalled();
  });

  it('nome novo com mais de 40 caracteres: recusa sem rascunho', async () => {
    const reply = await say('A', `renomear cartao Nubank para ${'x'.repeat(41)}`);
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.nameLength);
    expect(world.sessions).toHaveLength(0);
  });

  it('sem "para" a frase nao vira comando de cartao (cai no caminho de hoje)', async () => {
    const reply = await say('A', 'renomear cartao Nubank');
    expect(reply.kind).not.toBe('CONFIRM_DRAFT');
    expect(world.sessions).toHaveLength(0);
    expect(namesOf('A')).toEqual(['Nubank']);
  });

  it('cartao inexistente: recusa com a lista dos cartoes ativos, sem rascunho', async () => {
    const reply = await say('A', 'renomear cartao Itaú para Azul');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.notFound('Itaú', ['Nubank']));
    expect(world.sessions).toHaveLength(0);
  });

  it('termo que bate com mais de um cartao: pede o nome completo, sem rascunho', async () => {
    world.cards.push({ id: 'cr-A-nu2', userId: USER_ID.A, name: 'Nu Roxo', isDefault: false, archivedAt: null, closingDay: 3, dueDay: null });
    world.cards.push({ id: 'cr-A-nu3', userId: USER_ID.A, name: 'Nu Azul', isDefault: false, archivedAt: null, closingDay: 3, dueDay: null });
    const reply = await say('A', 'renomear cartao Nu para Verde');
    expect(reply.kind).toBe('ERROR');
    // Ordem da lista nao e verificada aqui (o fake nao aplica orderBy); o que importa: pede o nome completo e lista todos.
    expect(reply.text).toContain('Mais de um cartão bate com "Nu"');
    for (const name of ['Nubank', 'Nu Azul', 'Nu Roxo']) expect(reply.text).toContain(name);
    expect(reply.text.endsWith('Refaça com o nome completo.')).toBe(true);
    expect(world.sessions).toHaveLength(0);
  });

  it('cartao arquivado nao casa: segue como inexistente', async () => {
    cardRow('cr-B-bradesco')!.archivedAt = T0;
    const reply = await say('B', 'renomear cartao Bradesco para Verde');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.notFound('Bradesco', ['Itaú']));
    expect(world.sessions).toHaveLength(0);
  });

  it('usuario sem nenhum cartao ativo: "voce ainda nao tem cartao ativo", sem rascunho', async () => {
    const reply = await say('C', 'renomear cartao Nubank para Verde');
    expect(reply.text).toBe(CARD_READ_REPLIES.none);
    expect(world.sessions).toHaveLength(0);
  });

  it('nome da corrida: outro cartao com o mesmo nome entre o rascunho e a confirmacao; nada e gravado', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho');
    world.cards.push({ id: 'cr-A-roxo', userId: USER_ID.A, name: 'Roxinho', isDefault: false, archivedAt: null, closingDay: 3, dueDay: null });
    const reply = await say('A', 'confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.nameTaken);
    expect(reply.state).toBe('IDLE');
    expect(cardRow('cr-A-nubank')?.name).toBe('Nubank');
  });

  it('cartao arquivado entre o rascunho e a confirmacao: recusa clara, nada gravado', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho');
    cardRow('cr-A-nubank')!.archivedAt = T0;
    const reply = await say('A', 'confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.cardArchived);
    expect(cardRow('cr-A-nubank')?.name).toBe('Nubank');
  });

  it('regressao 8d: definir limite por nome nao casa cartao arquivado nem de outro dono (sobrevivente da revisao 9b-2/3)', async () => {
    cardRow('cr-B-bradesco')!.archivedAt = T0;
    const archived = await say('B', 'definir limite do bradesco 100');
    expect(archived.text).toBe(CL_REPLIES.cardNotFound('bradesco', ['Itaú']));
    expect(world.sessions).toHaveLength(0);
    const alien = await say('A', 'definir limite do itau 100');
    expect(alien.text).toBe(CL_REPLIES.cardNotFound('itau', ['Nubank']));
    expect(world.sessions).toHaveLength(0);
  });

  it('cartao removido entre o rascunho e a confirmacao: "nao encontrado", nada gravado', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho');
    world.cards.splice(world.cards.findIndex((card) => card.id === 'cr-A-nubank'), 1);
    const reply = await say('A', 'confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.cardGone);
  });

  it('resultado desconhecido (commit sem confirmacao): nao restaura, nao oferece nova gravacao', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho');
    updateSpy().mockRejectedValueOnce(new CreditCardWriteUncertainError());
    const reply = await say('A', 'confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(REPLIES.writeUncertain);
    expect(reply.state).toBe('IDLE');
    expect(world.sessions).toHaveLength(0);
    const again = await say('A', 'confirmar');
    expect(again.kind).not.toBe('DONE');
    expect(updateSpy()).toHaveBeenCalledTimes(1);
  });

  it('falha antes do commit: o rascunho fica e pode ser confirmado de novo', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho');
    updateSpy().mockRejectedValueOnce(new Error('queda antes do commit'));
    const failed = await say('A', 'confirmar');
    expect(failed.kind).toBe('ERROR');
    expect(failed.text).toBe(CARD_WRITE_REPLIES.renameSaveFailed);
    expect(failed.state).toBe('AWAITING_CONFIRMATION');
    expect(cardRow('cr-A-nubank')?.name).toBe('Nubank');
    const done = await say('A', 'confirmar');
    expect(done.kind).toBe('DONE');
    expect(cardRow('cr-A-nubank')?.name).toBe('Roxinho');
  });

  it('canal Telegram com a trava desligada: nada e gravado, so orienta o app', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho', 'TELEGRAM' as ConversationChannel);
    const reply = await say('A', 'confirmar', 'TELEGRAM' as ConversationChannel);
    expect(reply.kind).toBe('INFO');
    expect(reply.text).toBe(REPLIES.whatsappWritesOff);
    expect(updateSpy()).not.toHaveBeenCalled();
    expect(namesOf('A')).toEqual(['Nubank']);
  });

  it('isolamento A/B/C: A nao renomeia cartao de B, mesmo com o nome exato', async () => {
    const reply = await say('A', 'renomear cartao Itaú para Azul');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.notFound('Itaú', ['Nubank']));
    expect(cardRow('cr-B-itau')?.name).toBe('Itaú');
    expect(updateSpy()).not.toHaveBeenCalled();
  });

  it('isolamento: B renomeia o proprio cartao, e o update sai com o id e o userId de B', async () => {
    await say('B', 'renomear cartao Bradesco para Verde');
    await say('B', 'confirmar');
    expect(updateSpy()).toHaveBeenCalledWith(USER_ID.B, 'cr-B-bradesco', { name: 'Verde' });
    expect(cardRow('cr-B-bradesco')?.name).toBe('Verde');
    expect(cardRow('cr-A-nubank')?.name).toBe('Nubank');
  });

  it('o cartao renomeado aparece nas buscas por nome da 9b-1 e 9b-2 (leitura e lista)', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho');
    await say('A', 'confirmar');
    const read = await say('A', 'cartao Roxinho');
    expect(read.kind).toBe('INFO');
    expect(read.text.startsWith('Cartão: Roxinho')).toBe(true);
    const list = await say('A', 'meus cartoes');
    expect(list.text).toContain('Roxinho (padrão)');
    expect(list.text).not.toContain('Nubank');
  });

  it('o padrao continua o mesmo cartao depois de renomear (so muda o nome)', async () => {
    await say('A', 'renomear cartao Nubank para Roxinho');
    await say('A', 'confirmar');
    expect(cardRow('cr-A-nubank')?.isDefault).toBe(true);
  });
});

describe('Criar cartao pela conversa: recusado por ora (9b-3)', () => {
  it.each(['criar cartao Nubank', 'novo cartao Nubank', 'adicionar cartao Nubank', 'cadastrar cartao Nubank'])(
    '"%s" responde que ainda nao esta disponivel, sem rascunho e sem gravar',
    async (text) => {
      const before = world.cards.length;
      const reply = await say('A', text);
      expect(reply.kind).toBe('INFO');
      expect(reply.text).toBe(CARD_WRITE_REPLIES.createUnavailable);
      expect(reply.state).toBe('IDLE');
      expect(world.sessions).toHaveLength(0);
      expect(world.cards.length).toBe(before);
      expect(updateSpy()).not.toHaveBeenCalled();
    },
  );
});
