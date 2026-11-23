import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ConversationController } from './conversation.controller';
import { SendConversationMessageDto } from './dto/send-conversation-message.dto';
import { ConfirmConversationDraftDto } from './dto/confirm-conversation-draft.dto';
import { ConversationService } from './conversation.service';

/** Mesmas opcoes do ValidationPipe global (main.ts). */
const globalPipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

describe('ConversationController', () => {
  const user = { sub: 'user-a', email: 'a@x.com', role: 'USER', sessionId: 's1' } as unknown as AuthenticatedUser;
  let service: Record<string, jest.Mock>;
  let controller: ConversationController;

  beforeEach(() => {
    service = {
      handleMessage: jest.fn(async () => ({ kind: 'INFO', state: 'IDLE', text: 'ok' })),
      confirmDraft: jest.fn(async () => null),
      cancelDraft: jest.fn(async () => null),
      getSession: jest.fn(async () => ({ state: 'IDLE' })),
    };
    controller = new ConversationController(service as unknown as ConversationService);
  });

  it('userId vem do JWT e o canal APP e fixo', async () => {
    await controller.message(user, { messageId: randomUUID(), text: 'saldo' });
    expect(service.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-a', channel: 'APP', text: 'saldo' }),
    );
  });

  it('corpo com userId extra e rejeitado com 400 pelo ValidationPipe global', async () => {
    await expect(
      globalPipe.transform(
        { messageId: randomUUID(), text: 'saldo', userId: 'user-b' },
        { type: 'body', metatype: SendConversationMessageDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirm com draftVersion 0 e rejeitado (minimo 1)', async () => {
    await expect(
      globalPipe.transform(
        { draftId: randomUUID(), draftVersion: 0 },
        { type: 'body', metatype: ConfirmConversationDraftDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirm de rascunho inexistente, de outra conta ou versao antiga vira 404 com a mesma mensagem', async () => {
    await expect(controller.confirm(user, { draftId: randomUUID(), draftVersion: 1 })).rejects.toThrow(
      NotFoundException,
    );
    expect(service.confirmDraft).toHaveBeenCalledWith('user-a', expect.any(String), 1, false, false);
  });

  it('confirm com delete: true repassa a flag de apagar explicita; sem flag segue false', async () => {
    const draftId = randomUUID();
    const done = { kind: 'DONE', state: 'IDLE', text: 'Apaguei' };
    service.confirmDraft.mockResolvedValueOnce(done).mockResolvedValueOnce(done);
    await controller.confirm(user, { draftId, draftVersion: 2, delete: true });
    expect(service.confirmDraft).toHaveBeenLastCalledWith('user-a', draftId, 2, true, false);
    await controller.confirm(user, { draftId, draftVersion: 2 });
    expect(service.confirmDraft).toHaveBeenLastCalledWith('user-a', draftId, 2, false, false);
  });

  it('confirm com clear: true repassa a flag de limpar teto (8d); string nao vale', async () => {
    const draftId = randomUUID();
    const done = { kind: 'DONE', state: 'IDLE', text: 'Teto removido' };
    service.confirmDraft.mockResolvedValueOnce(done);
    await controller.confirm(user, { draftId, draftVersion: 2, clear: true });
    expect(service.confirmDraft).toHaveBeenLastCalledWith('user-a', draftId, 2, false, true);
    await expect(
      globalPipe.transform(
        { draftId: randomUUID(), draftVersion: 1, clear: 'true' },
        { type: 'body', metatype: ConfirmConversationDraftDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirm com delete diferente de true e rejeitado pelo ValidationPipe', async () => {
    await expect(
      globalPipe.transform(
        { draftId: randomUUID(), draftVersion: 1, delete: false },
        { type: 'body', metatype: ConfirmConversationDraftDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('delete com as opcoes reais do pipe global (enableImplicitConversion)', () => {
    const realPipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const run = (extra: Record<string, unknown>) =>
      realPipe.transform(
        { draftId: randomUUID(), draftVersion: 1, ...extra },
        { type: 'body', metatype: ConfirmConversationDraftDto },
      ) as Promise<ConfirmConversationDraftDto>;

    it('sem delete passa (confirmar normal) e delete: true passa como true', async () => {
      expect((await run({})).delete).toBeUndefined();
      expect((await run({ delete: true })).delete).toBe(true);
    });

    it.each([false, 'false', 'true', 0, 1, 'x', []])('delete %p e rejeitado com 400 (so o booleano true vale)', async (value) => {
      await expect(run({ delete: value })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('cancel de rascunho alheio vira 404', async () => {
    await expect(controller.cancel(user, { draftId: randomUUID() })).rejects.toThrow(NotFoundException);
  });

  it('session le so a conta do JWT', async () => {
    await controller.session(user);
    expect(service.getSession).toHaveBeenCalledWith('user-a');
  });
});
