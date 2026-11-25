import { ConversationChannel } from '@prisma/client';
import { CreditCardWriteUncertainError, MAX_ACTIVE_CARDS_PER_USER } from '../credit-cards/credit-cards.service';
import { CARD_WRITE_REPLIES } from './card-write';
import { CL_REPLIES } from './credit-limit';
import { CARD_READ_REPLIES } from './card-read';
import { REPLIES } from './replies';
import { Engine, T0, USER_ID, World, buildEngine, seedWorld } from './isolation.fixture';

/**
 * Renomear e criar cartao pela conversa (9b-3 e 9b-3b). Motor real sobre o mundo fake; o CreditCardsService e o real
 * (teto, nome unico, cartao ativo, lock), so o Prisma por baixo e fake.
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

describe('Criar cartao pela conversa (9b-3b)', () => {
  const createSpy = () => (world.services.creditCards as unknown as { create: jest.Mock }).create;
  const C_CARD = (id: string, name: string) => ({ id, userId: USER_ID.C, name, isDefault: false, archivedAt: null, closingDay: 3, dueDay: null });
  const cardsOf = (who: Who) => world.cards.filter((card) => card.userId === USER_ID[who]);

  it.each(['criar cartao', 'novo cartao', 'adicionar cartao', 'cadastrar cartao'])(
    '"%s Roxinho" abre rascunho e pergunta o fechamento, sem gravar',
    async (verb) => {
      const reply = await say('C', `${verb} Roxinho`);
      expect(reply.kind).toBe('ASK_FIELD');
      expect(reply.state).toBe('COLLECTING_FIELDS');
      expect(reply.text).toBe(CARD_WRITE_REPLIES.askClosingDay('Roxinho'));
      expect(reply.draft).toMatchObject({ kind: 'CARD_CREATE', title: 'Criar cartão', pendingField: 'closingDay' });
      expect(reply.draft?.rows).toEqual([
        { label: 'Cartão', value: 'Roxinho' },
        { label: 'Fechamento', value: 'a informar' },
        { label: 'Vencimento', value: 'sem vencimento' },
        { label: 'Padrão', value: 'não' },
      ]);
      expect(cardsOf('C')).toHaveLength(0);
      expect(createSpy()).not.toHaveBeenCalled();
    },
  );

  it('pergunta do fechamento: "dia 10" completa o rascunho; confirmar grava pelo CreditCardsService e responde com o recibo', async () => {
    await say('C', 'criar cartao Roxinho');
    const asked = await say('C', 'dia 10');
    expect(asked.kind).toBe('CONFIRM_DRAFT');
    expect(asked.state).toBe('AWAITING_CONFIRMATION');
    expect(asked.draft?.rows?.[1]).toEqual({ label: 'Fechamento', value: 'dia 10' });
    expect(asked.text).toContain('Não será o cartão padrão.');
    expect(createSpy()).not.toHaveBeenCalled();

    const done = await say('C', 'confirmar');
    expect(done.kind).toBe('DONE');
    expect(done.text).toBe('Cartão Roxinho criado, fecha dia 10.');
    expect(done.data?.cardId).toEqual(expect.any(String));
    expect(createSpy()).toHaveBeenCalledWith(USER_ID.C, { name: 'Roxinho', closingDay: 10, dueDay: null });
    // O evento guarda o id do cartao criado (rastro da escrita), nao o nome.
    expect(world.events.find((row) => row.intent === 'create_card' && row.outcome === 'COMPLETED')?.resultRef).toBe(done.data?.cardId);
    const created = cardsOf('C');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: 'Roxinho', closingDay: 10, dueDay: null, isDefault: false });
    expect(world.sessions).toHaveLength(0);
  });

  it('dia de fechamento e vencimento na frase: sem pergunta, confirmar grava os dois', async () => {
    const draft = await say('C', 'criar cartao Roxinho fecha dia 10 vence dia 17');
    expect(draft.kind).toBe('CONFIRM_DRAFT');
    expect(draft.text).toContain('Vence: dia 17.');
    const done = await say('C', 'confirmar');
    expect(done.text).toBe('Cartão Roxinho criado, fecha dia 10, vence dia 17.');
    expect(createSpy()).toHaveBeenCalledWith(USER_ID.C, { name: 'Roxinho', closingDay: 10, dueDay: 17 });
    expect(cardsOf('C')[0]).toMatchObject({ closingDay: 10, dueDay: 17 });
  });

  it('resposta so com o numero ("10", sem a palavra dia) completa o rascunho', async () => {
    await say('C', 'criar cartao Roxinho');
    const asked = await say('C', '10');
    expect(asked.kind).toBe('CONFIRM_DRAFT');
    expect(asked.draft?.rows?.[1]).toEqual({ label: 'Fechamento', value: 'dia 10' });
  });

  it('resposta invalida repete a pergunta e segue no rascunho; nada e gravado', async () => {
    await say('C', 'criar cartao Roxinho');
    for (const value of ['40', '0', 'abc', '10 e 12']) {
      const again = await say('C', value);
      expect(again.kind).toBe('ASK_FIELD');
      expect(again.state).toBe('COLLECTING_FIELDS');
      expect(again.text).toBe(`${CARD_WRITE_REPLIES.closingDayInvalid}\n${CARD_WRITE_REPLIES.askClosingDay('Roxinho')}`);
    }
    expect(world.sessions).toHaveLength(1);
    expect(createSpy()).not.toHaveBeenCalled();
    expect(cardsOf('C')).toHaveLength(0);
  });

  it('cancelar o rascunho nao grava', async () => {
    await say('C', 'criar cartao Roxinho fecha dia 10');
    const cancelled = await say('C', 'cancelar');
    expect(cancelled.kind).toBe('CANCELLED');
    expect(createSpy()).not.toHaveBeenCalled();
    expect(cardsOf('C')).toHaveLength(0);
  });

  it('rascunho vencido nao grava na confirmacao', async () => {
    await say('C', 'criar cartao Roxinho fecha dia 10');
    const late = await say('C', 'confirmar', 'APP' as ConversationChannel, LATER);
    expect(late.kind).toBe('EXPIRED');
    expect(createSpy()).not.toHaveBeenCalled();
    expect(cardsOf('C')).toHaveLength(0);
  });

  it('dia invalido na frase recusa sem rascunho e sem gravar', async () => {
    const reply = await say('C', 'criar cartao Roxinho fecha dia 40');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.createBadDay('fechamento'));
    expect(reply.state).toBe('IDLE');
    expect(world.sessions).toHaveLength(0);
  });

  it('sem nome: recusa pedindo o nome, sem rascunho', async () => {
    const reply = await say('C', 'criar cartao fecha dia 10');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.createNeedsName);
    expect(world.sessions).toHaveLength(0);
  });

  it('nome com mais de 40 caracteres: recusa sem rascunho', async () => {
    const reply = await say('C', `criar cartao ${'x'.repeat(41)}`);
    expect(reply.text).toBe(CARD_WRITE_REPLIES.nameLength);
    expect(world.sessions).toHaveLength(0);
  });

  it('nome igual a um cartao ativo (sem caixa, sem acento): recusa sem rascunho', async () => {
    const reply = await say('A', 'criar cartao NÚBANK fecha dia 10');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.createNameTaken);
    expect(world.sessions).toHaveLength(0);
    expect(createSpy()).not.toHaveBeenCalled();
  });

  it('teto de 10 cartoes ativos: recusa sem rascunho', async () => {
    for (let i = 0; i < MAX_ACTIVE_CARDS_PER_USER; i += 1) world.cards.push(C_CARD(`cr-C-${i}`, `Cartao ${i}`));
    const reply = await say('C', 'criar cartao Roxinho fecha dia 10');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.createLimit(MAX_ACTIVE_CARDS_PER_USER));
    expect(world.sessions).toHaveLength(0);
    expect(createSpy()).not.toHaveBeenCalled();
  });

  it('teto atingido entre o rascunho e a confirmacao: recusa clara, nada gravado', async () => {
    for (let i = 0; i < MAX_ACTIVE_CARDS_PER_USER - 1; i += 1) world.cards.push(C_CARD(`cr-C-${i}`, `Cartao ${i}`));
    await say('C', 'criar cartao Roxinho fecha dia 10');
    world.cards.push(C_CARD('cr-C-extra', 'Cartao extra'));
    const reply = await say('C', 'confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.createLimit(MAX_ACTIVE_CARDS_PER_USER));
    expect(reply.state).toBe('IDLE');
    expect(cardsOf('C')).toHaveLength(MAX_ACTIVE_CARDS_PER_USER);
    expect(world.sessions).toHaveLength(0);
  });

  it('nome tomado entre o rascunho e a confirmacao (sem acento): recusa, nada gravado', async () => {
    await say('C', 'criar cartao Roxinho fecha dia 10');
    world.cards.push(C_CARD('cr-C-roxo', 'Róxinho'));
    const reply = await say('C', 'confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_WRITE_REPLIES.createNameTaken);
    expect(createSpy()).not.toHaveBeenCalled();
    expect(cardsOf('C').map((card) => card.name)).toEqual(['Róxinho']);
  });

  it('resultado desconhecido (commit sem confirmacao): nao restaura, nao oferece nova gravacao', async () => {
    await say('C', 'criar cartao Roxinho fecha dia 10');
    createSpy().mockRejectedValueOnce(new CreditCardWriteUncertainError());
    const reply = await say('C', 'confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(REPLIES.writeUncertain);
    expect(reply.state).toBe('IDLE');
    expect(world.sessions).toHaveLength(0);
    const again = await say('C', 'confirmar');
    expect(again.kind).not.toBe('DONE');
    expect(createSpy()).toHaveBeenCalledTimes(1);
  });

  it('falha antes do commit: o rascunho fica e pode ser confirmado de novo', async () => {
    await say('C', 'criar cartao Roxinho fecha dia 10');
    createSpy().mockRejectedValueOnce(new Error('queda antes do commit'));
    const failed = await say('C', 'confirmar');
    expect(failed.kind).toBe('ERROR');
    expect(failed.text).toBe(CARD_WRITE_REPLIES.createSaveFailed);
    expect(failed.state).toBe('AWAITING_CONFIRMATION');
    expect(cardsOf('C')).toHaveLength(0);
    const done = await say('C', 'confirmar');
    expect(done.kind).toBe('DONE');
    expect(cardsOf('C').map((card) => card.name)).toEqual(['Roxinho']);
  });

  it('canal Telegram com a trava desligada: nada e gravado, so orienta o app', async () => {
    await say('C', 'criar cartao Roxinho fecha dia 10', 'TELEGRAM' as ConversationChannel);
    const reply = await say('C', 'confirmar', 'TELEGRAM' as ConversationChannel);
    expect(reply.kind).toBe('INFO');
    expect(reply.text).toBe(REPLIES.whatsappWritesOff);
    expect(createSpy()).not.toHaveBeenCalled();
    expect(cardsOf('C')).toHaveLength(0);
  });

  it('isolamento: A cria "Itaú" mesmo com o nome de B; o cartao e de A; B nao muda', async () => {
    await say('A', 'criar cartao Itaú fecha dia 5');
    const done = await say('A', 'confirmar');
    expect(done.kind).toBe('DONE');
    expect(createSpy()).toHaveBeenCalledWith(USER_ID.A, { name: 'Itaú', closingDay: 5, dueDay: null });
    expect(cardsOf('A').map((card) => card.name).sort()).toEqual(['Itaú', 'Nubank']);
    expect(cardsOf('B').map((card) => card.name).sort()).toEqual(['Bradesco', 'Itaú']);
    expect(cardRow('cr-B-itau')?.name).toBe('Itaú');
  });

  it('cartao criado nao vira padrao: o padrao de quem ja tinha cartao continua o mesmo', async () => {
    await say('A', 'criar cartao Roxinho fecha dia 10');
    await say('A', 'confirmar');
    const created = cardsOf('A').find((card) => card.name === 'Roxinho');
    expect(created?.isDefault).toBe(false);
    expect(cardRow('cr-A-nubank')?.isDefault).toBe(true);
  });

  it('cartao criado aparece em "meus cartoes" e na leitura por nome da 9b-2', async () => {
    await say('C', 'criar cartao Roxinho fecha dia 10');
    await say('C', 'confirmar');
    const read = await say('C', 'cartao Roxinho');
    expect(read.kind).toBe('INFO');
    expect(read.text.startsWith('Cartão: Roxinho')).toBe(true);
    const list = await say('C', 'meus cartoes');
    expect(list.text).toContain('Roxinho');
  });
});
