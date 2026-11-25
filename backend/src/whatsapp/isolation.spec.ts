/**
 * Testes de isolamento A/B/C do canal WhatsApp (item 6): vinculo, webhook, troca de numeros e trava de escrita.
 * Usa o motor, o servico de vinculo e o adaptador reais sobre o banco em memoria de
 * `conversation/isolation.fixture.ts`, que respeita todo `where`. Mutantes: resultado-6.md.
 */
import { Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import {
  JID,
  KEYWORD,
  SECRETS,
  T0,
  USER_ID,
  WEBHOOK_SECRET,
  WHO,
  Who,
  World,
  WhatsappStack,
  buildWhatsapp,
  forbiddenFor,
  inbound,
  linkAll,
  seedWorld,
} from '../conversation/isolation.fixture';
import { REPLIES } from '../conversation/replies';
import { WHATSAPP_TEXTS } from './whatsapp-adapter.service';
import { WhatsappController } from './whatsapp.controller';

describe('Isolamento A/B/C do WhatsApp', () => {
  let world: World;
  let stack: WhatsappStack;
  let logged: string[];
  const spies: jest.SpyInstance[] = [];
  let counter = 0;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    world = seedWorld();
    stack = buildWhatsapp(world, true);
    logged = [];
    counter = 0;
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
      spies.push(jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' '))));
    }
  });

  afterEach(() => {
    jest.useRealTimers();
    spies.splice(0).forEach((spy) => spy.mockRestore());
  });

  const nextId = () => `msg-${(counter += 1)}`;
  const say = (who: Who | string, text: string, id: string = nextId(), extra?: Parameters<typeof inbound>[3]) =>
    stack.adapter.handleInbound(inbound(who, text, id, extra));
  const sentTo = (who: Who | string) => stack.sent.filter((item) => item.jid === (who in JID ? JID[who as Who] : who));
  const sessionOf = (who: Who, channel: 'APP' | 'WHATSAPP') => world.sessions.find((row) => row.userId === USER_ID[who] && row.channel === channel);
  const lastText = (who: Who) => sentTo(who).at(-1)?.text ?? '';

  describe('vinculo por codigo, so de dentro da conta', () => {
    it('A, B e C vinculam seus numeros: cada JID resolve para a conta que gerou o codigo', async () => {
      await linkAll(world, stack);

      for (const who of WHO) {
        expect(await stack.links.findUserIdByJid(JID[who])).toBe(USER_ID[who]);
        expect((await stack.links.getStatus(USER_ID[who])).linked).toBe(true);
      }
      expect(world.links).toHaveLength(3);
      // So hash no banco; o codigo em claro nunca esta guardado.
      expect(JSON.stringify(world.linkCodes)).not.toMatch(/"codeHash":"[A-Z2-9]{8}"/);
    });

    it('codigo de B enviado do numero de A (ja vinculado a A): A segue dona do numero, B nao vincula e o codigo nao e tocado', async () => {
      await stack.links.createCode(USER_ID.A).then(({ code }) => say('A', code));
      const codeB = (await stack.links.createCode(USER_ID.B)).code;

      // Pelo webhook, o numero de A e tratado como conversa de A: o codigo nem chega ao resgate.
      await say('A', codeB);

      expect(world.links.map((row) => [row.userId, row.jid])).toEqual([[USER_ID.A, JID.A]]);
      expect(world.linkCodes.find((row) => row.userId === USER_ID.B)?.usedAt).toBeNull();
      expect(JSON.stringify(sentTo('A'))).not.toContain(SECRETS.B.balance);
    });

    it('resgate direto de B com o numero de A: recusado e o vinculo de A fica (o codigo fica consumido, de proposito)', async () => {
      await stack.links.createCode(USER_ID.A).then(({ code }) => say('A', code));
      const codeB = (await stack.links.createCode(USER_ID.B)).code;

      expect(await stack.links.redeem(JID.A, codeB)).toBe(false);

      expect(world.links.map((row) => [row.userId, row.jid])).toEqual([[USER_ID.A, JID.A]]);
    });

    it('mesmo JID em duas contas: o segundo resgate e recusado e o dono continua o mesmo', async () => {
      const codeA = (await stack.links.createCode(USER_ID.A)).code;
      const codeB = (await stack.links.createCode(USER_ID.B)).code;
      await say('A', codeA);

      const redeemed = await stack.links.redeem(JID.A, codeB);

      expect(redeemed).toBe(false);
      expect(await stack.links.findUserIdByJid(JID.A)).toBe(USER_ID.A);
      expect((await stack.links.getStatus(USER_ID.B)).linked).toBe(false);
    });

    it('resgates simultaneos do mesmo codigo por dois numeros: um vinculo so', async () => {
      const { code } = await stack.links.createCode(USER_ID.A);

      const results = await Promise.all([stack.links.redeem(JID.B, code), stack.links.redeem(JID.C, code)]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(world.links.filter((row) => row.userId === USER_ID.A)).toHaveLength(1);
    });

    it('conta B vincula com A ja vinculada: resgate de B nao e barrado pelo vinculo de A', async () => {
      await say('A', (await stack.links.createCode(USER_ID.A)).code);
      const codeB = (await stack.links.createCode(USER_ID.B)).code;

      expect(await stack.links.redeem(JID.B, codeB)).toBe(true);
      expect(world.links.map((row) => row.userId).sort()).toEqual([USER_ID.A, USER_ID.B]);
    });

    it('gerar codigo para A com B ja vinculada funciona; gerar de novo invalida so o codigo anterior de A', async () => {
      await say('B', (await stack.links.createCode(USER_ID.B)).code);
      const codeC = (await stack.links.createCode(USER_ID.C)).code;

      const first = await stack.links.createCode(USER_ID.A);
      const second = await stack.links.createCode(USER_ID.A);

      expect(await stack.links.redeem(JID.A, first.code)).toBe(false);
      expect(await stack.links.redeem(JID.C, codeC)).toBe(true);
      expect(await stack.links.redeem(JID.A, second.code)).toBe(true);
    });

    it('conta ja vinculada nao gera codigo (409), sem olhar o vinculo de outra conta', async () => {
      await say('A', (await stack.links.createCode(USER_ID.A)).code);

      await expect(stack.links.createCode(USER_ID.A)).rejects.toMatchObject({ status: 409 });
      await expect(stack.links.createCode(USER_ID.B)).resolves.toHaveProperty('code');
    });

    it('status: cada conta ve so o proprio vinculo, mascarado', async () => {
      await say('B', (await stack.links.createCode(USER_ID.B)).code);

      const statusA = await stack.links.getStatus(USER_ID.A);
      const statusB = await stack.links.getStatus(USER_ID.B);

      expect(statusA.linked).toBe(false);
      expect(statusA).not.toHaveProperty('maskedNumber');
      expect(statusB.linked).toBe(true);
      expect(JSON.stringify(statusB)).not.toContain(JID.B.split('@')[0]);
      expect(JSON.stringify(statusA)).not.toContain(JID.B.split('@')[0]);
    });

    it('desvincular A nao toca no vinculo, na sessao WHATSAPP nem no codigo de B; preserva a sessao APP de A', async () => {
      await linkAll(world, stack);
      await say('A', '50 mercado');
      await say('B', `50 ${KEYWORD.B.category}`);
      await stack.engine.service.handleMessage({ userId: USER_ID.A, channel: 'APP', messageId: 'app-A', text: '50 mercado', receivedAt: new Date() });

      await stack.links.unlinkByUserId(USER_ID.A);

      expect(world.links.map((row) => row.userId).sort()).toEqual([USER_ID.B, USER_ID.C]);
      expect(sessionOf('A', 'WHATSAPP')).toBeUndefined();
      expect(sessionOf('A', 'APP')).toBeDefined();
      expect(sessionOf('B', 'WHATSAPP')).toBeDefined();
      await stack.links.unlinkByUserId(USER_ID.A);
      expect(world.links).toHaveLength(2);
    });
  });

  describe('2. userId, accountId e outros campos trocados no webhook', () => {
    beforeEach(async () => {
      await linkAll(world, stack);
    });

    it('campos extras em data, no topo e em key: ignorados, o dono e o do `from`', async () => {
      const hostile = {
        data: {
          userId: USER_ID.B,
          accountId: USER_ID.B,
          user: { id: USER_ID.B },
          participant: JID.B,
          owner: USER_ID.B,
          key: { id: 'hostil-1', remoteJid: JID.B, fromMe: false, participant: JID.B },
        },
        top: { userId: USER_ID.B, accountId: USER_ID.B, user: USER_ID.B, remoteJid: JID.B },
      };

      await say('A', 'saldo', 'hostil-1', hostile);

      expect(sentTo('B')).toHaveLength(0);
      expect(sentTo('A')).toHaveLength(1);
      expect(lastText('A')).toContain(SECRETS.A.balance);
      expect(JSON.stringify(sentTo('A'))).not.toContain(SECRETS.B.balance);
      expect(world.events.filter((row) => row.messageId === 'hostil-1').map((row) => row.userId)).toEqual([USER_ID.A]);
    });

    it('remoteJid de B com from de A: processa como A, responde so para o numero de A', async () => {
      await say('A', `50 ${KEYWORD.A.category}`, 'hostil-2', { data: { key: { id: 'hostil-2', remoteJid: JID.B, fromMe: false } } });

      expect(sessionOf('A', 'WHATSAPP')).toBeDefined();
      expect(sessionOf('B', 'WHATSAPP')).toBeUndefined();
      expect(sentTo('B')).toHaveLength(0);
    });

    it('from de numero sem vinculo mandando userId de A: nao entra no motor e nao ve nada de A', async () => {
      const stranger = '5599900000099@s.whatsapp.net';

      await say(stranger, 'saldo', 'hostil-3', { data: { userId: USER_ID.A, accountId: USER_ID.A }, top: { userId: USER_ID.A } });

      expect(world.services.dashboard.getSummary).not.toHaveBeenCalled();
      expect(world.events).toHaveLength(0);
      expect(JSON.stringify(stack.sent)).not.toContain(SECRETS.A.balance);
    });

    it('pedido de A com texto contendo o id de B: o texto nao define dono', async () => {
      await say('A', `saldo ${USER_ID.B}`);
      await say('A', `50 mercado user-B ${JID.B}`);

      expect(world.services.dashboard.getSummary.mock.calls.every(([userId]) => userId === USER_ID.A)).toBe(true);
      expect(world.calls.every((call) => call.userId === USER_ID.A)).toBe(true);
    });
  });

  describe('webhook assinado (controller)', () => {
    function sign(body: unknown, secret = WEBHOOK_SECRET) {
      const raw = Buffer.from(JSON.stringify(body));
      return { raw, header: `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` };
    }
    const makeController = () => new WhatsappController(stack.config, stack.links, stack.adapter);

    it('assinatura valida com userId/accountId extras: processa no dono do numero, nao no que o corpo diz', async () => {
      await linkAll(world, stack);
      const handle = jest.spyOn(stack.adapter, 'handleInbound');
      const body = inbound('A', 'saldo', 'ctl-1', { data: { userId: USER_ID.B, accountId: USER_ID.B }, top: { userId: USER_ID.B } });
      const { raw, header } = sign(body);

      expect(makeController().webhook({ rawBody: raw } as never, header, body)).toEqual({ ok: true });
      await handle.mock.results[0].value;

      expect(lastText('A')).toContain(SECRETS.A.balance);
      expect(sentTo('B')).toHaveLength(0);
    });

    it('sem assinatura, assinatura de outro segredo, corpo alterado e sem rawBody: 401 e o motor nao e chamado', async () => {
      await linkAll(world, stack);
      const handle = jest.spyOn(stack.adapter, 'handleInbound');
      const body = inbound('A', 'saldo', 'ctl-2');
      const good = sign(body);
      const wrongSecret = sign(body, 'outro-segredo');
      const tampered = sign({ ...body, extra: 1 });

      const controller = makeController();
      expect(() => controller.webhook({ rawBody: good.raw } as never, undefined, body)).toThrow(UnauthorizedException);
      expect(() => controller.webhook({ rawBody: good.raw } as never, wrongSecret.header, body)).toThrow(UnauthorizedException);
      expect(() => controller.webhook({ rawBody: good.raw } as never, tampered.header, body)).toThrow(UnauthorizedException);
      expect(() => controller.webhook({} as never, good.header, body)).toThrow(UnauthorizedException);

      expect(handle).not.toHaveBeenCalled();
      expect(stack.sent).toHaveLength(0);
    });
  });

  describe('4. alternar numeros', () => {
    beforeEach(async () => {
      await linkAll(world, stack);
    });

    it('A, B e C no mesmo instante: cada resposta sai so para o numero de quem perguntou, com os proprios dados', async () => {
      await Promise.all(WHO.flatMap((who) => [say(who, 'saldo'), say(who, `50 ${KEYWORD[who].category}`), say(who, 'metas')]));

      for (const who of WHO) {
        const texts = sentTo(who).map((item) => item.text).join('\n');
        expect(texts).toContain(SECRETS[who].balance);
        expect(texts).toContain(SECRETS[who].goal);
        for (const forbidden of forbiddenFor(who)) {
          expect(texts).not.toContain(forbidden);
        }
        expect(sessionOf(who, 'WHATSAPP')).toBeDefined();
      }
    });

    it('JID de A reaproveitado depois de desvincular e vincular a B: A nao herda, B nao recebe a sessao antiga', async () => {
      await say('A', `50 ${KEYWORD.A.category}`);
      expect(sessionOf('A', 'WHATSAPP')).toBeDefined();
      await say('A', 'desvincular whatsapp');
      expect(sessionOf('A', 'WHATSAPP')).toBeUndefined();
      await stack.links.unlinkByUserId(USER_ID.B);
      stack.sent.length = 0;

      const codeB = (await stack.links.createCode(USER_ID.B)).code;
      await say('A', codeB);
      expect(await stack.links.findUserIdByJid(JID.A)).toBe(USER_ID.B);

      const txBefore = world.snapshot(USER_ID.A).transactions.length + world.snapshot(USER_ID.B).transactions.length;
      await say('A', 'confirmar');
      await say('A', 'sim');
      await say('A', 'saldo');

      expect(sessionOf('B', 'WHATSAPP')).toBeUndefined();
      expect(world.snapshot(USER_ID.A).transactions.length + world.snapshot(USER_ID.B).transactions.length).toBe(txBefore);
      const texts = sentTo('A').map((item) => item.text).join('\n');
      expect(texts).toContain(SECRETS.B.balance);
      expect(texts).not.toContain(SECRETS.A.balance);
      expect(world.writeCount).toBe(0);
    });

    it('depois de desvincular, o numero antigo de A vira desconhecido e nao enxerga mais a conta', async () => {
      await say('A', 'desvincular whatsapp');
      stack.sent.length = 0;

      await say('A', 'saldo');
      await say('A', 'saldo');

      expect(JSON.stringify(stack.sent)).not.toContain(SECRETS.A.balance);
      expect(stack.sent).toHaveLength(1);
      expect(stack.sent[0].text).toBe(WHATSAPP_TEXTS.hint);
    });

    it('A pode vincular outro numero depois de desvincular; o numero novo enxerga so a conta A', async () => {
      await say('A', 'desvincular whatsapp');
      const novo = '5511977770000@s.whatsapp.net';
      await say(novo, (await stack.links.createCode(USER_ID.A)).code);
      stack.sent.length = 0;

      await say(novo, 'saldo');

      expect(lastText('A')).toBe('');
      expect(sentTo(novo).at(-1)?.text).toContain(SECRETS.A.balance);
    });
  });

  describe('3. reentrega e confirmacao repetida pelo WhatsApp', () => {
    beforeEach(async () => {
      await linkAll(world, stack);
    });

    it('mesmo key.id duas vezes em sequencia: uma resposta, um evento', async () => {
      await say('A', 'saldo', 'dup-1');
      await say('A', 'saldo', 'dup-1');

      expect(sentTo('A')).toHaveLength(1);
      expect(world.events.filter((row) => row.messageId === 'dup-1')).toHaveLength(1);
    });

    it('mesmo key.id em paralelo: um evento so e nada gravado em duplicidade (a leitura pode responder mais de uma vez: ver resultado-6.md)', async () => {
      await Promise.all([say('B', 'saldo', 'dup-2'), say('B', 'saldo', 'dup-2'), say('B', 'saldo', 'dup-2')]);
      await say('B', `50 ${KEYWORD.B.category}`, 'dup-3');
      await Promise.all([say('B', 'confirmar', 'dup-4'), say('B', 'confirmar', 'dup-4'), say('B', 'confirmar', 'dup-4')]);

      expect(world.domainWrites).toHaveLength(1);
      expect(world.snapshot(USER_ID.B).transactions).toHaveLength(3);
      expect(sentTo('A')).toHaveLength(0);
      expect(world.events.filter((row) => row.messageId === 'dup-2')).toHaveLength(1);
    });

    it('confirmar duas vezes (mesma e diferentes key.id) e reentrega do confirmar: grava uma vez so', async () => {
      await say('A', `50 ${KEYWORD.A.category}`);

      await Promise.all([say('A', 'confirmar', 'c-1'), say('A', 'confirmar', 'c-1'), say('A', 'confirmar', 'c-2'), say('A', 'sim', 'c-3')]);
      await say('A', 'confirmar', 'c-4');

      expect(world.domainWrites.filter((call) => call.method === 'transactions.create')).toHaveLength(1);
      expect(world.snapshot(USER_ID.A).transactions).toHaveLength(3);
      expect(world.snapshot(USER_ID.B).transactions).toHaveLength(2);
    });
  });

  describe('7. logs e erros do adaptador', () => {
    beforeEach(async () => {
      await linkAll(world, stack);
    });

    it('falha de envio e falha do motor: log sem texto, sem saldo e sem id de outra conta', async () => {
      stack.client.sendText.mockRejectedValueOnce(Object.assign(new Error('WA-AKG envio falhou: http 500'), { name: 'WaAkgSendError' }));
      await say('A', 'saldo');
      world.services.dashboard.getSummary.mockRejectedValueOnce(new Error(`saldo ${SECRETS.B.balance} de ${USER_ID.B} ultrasecreto123`));
      await say('A', 'saldo ultrasecreto123');
      jest.spyOn(stack.engine.service, 'handleMessage').mockRejectedValueOnce(new Error(`vazou ${SECRETS.B.balance} ${USER_ID.B} ultrasecreto123`));
      await say('A', 'saldo');

      const joined = logged.join('\n');
      expect(joined).not.toContain('ultrasecreto123');
      expect(joined).not.toContain(SECRETS.B.balance);
      expect(joined).not.toContain(USER_ID.B);
      expect(joined).not.toContain(JID.A.split('@')[0]);
      expect(joined).not.toContain('saldo');
    });

    it('nem a resposta enviada nem os eventos guardam o texto digitado', async () => {
      await say('A', '50 mercado ultrasecreto123');

      expect(JSON.stringify(world.events)).not.toContain('ultrasecreto123');
      expect(logged.join('\n')).not.toContain('ultrasecreto123');
    });
  });

  describe('8. WHATSAPP_WRITES_ENABLED=false pelo webhook', () => {
    beforeEach(async () => {
      await linkAll(world, stack);
      stack.engine.settings.writesEnabled = false;
    });

    it.each([
      ['despesa', (who: Who) => `50 ${KEYWORD[who].category}`],
      ['receita', () => 'recebi 100 salario'],
      ['meta', () => 'criar meta viagem2 3 mil'],
      ['aporte', (who: Who) => `guardar 200 na ${KEYWORD[who].goal}`],
      ['reserva', () => 'criar reserva 400 gasolina'],
      ['limite', () => 'definir limite 5000'],
      ['conta fixa', () => 'criar conta fixa 120 internet mensal primeiro 20/11/2026'],
      ['parcela', () => 'criar parcelado 1200 geladeira em 12x primeiro 20/11/2026'],
    ])('%s: "confirmar", "sim", "ok" e variacoes nao gravam, e a resposta manda confirmar no app', async (_name, text) => {
      await say('A', text('A'));
      for (const confirm of ['confirmar', 'SIM', ' ok ', 'Confirmar!', 'confirmár']) {
        await say('A', confirm);
      }

      expect(world.writeCount).toBe(0);
      expect(sentTo('A').some((item) => item.text.includes(REPLIES.whatsappWritesOff))).toBe(true);
      expect(sessionOf('A', 'WHATSAPP')).toBeDefined();
    });

    it('ligar a trava libera a gravacao pelo mesmo caminho (controle)', async () => {
      await say('A', `50 ${KEYWORD.A.category}`);
      await say('A', 'confirmar');
      expect(world.writeCount).toBe(0);

      stack.engine.settings.writesEnabled = true;
      await say('A', 'confirmar');

      expect(world.writeCount).toBe(1);
    });

    it('o botao do app confirma o rascunho do proprio dono e so dele (D9), sem tocar nos outros', async () => {
      await say('A', `50 ${KEYWORD.A.category}`);
      await say('B', `50 ${KEYWORD.B.category}`);
      const draftA = (await stack.engine.service.getSession(USER_ID.A)).draft!;

      expect(await stack.engine.service.confirmDraft(USER_ID.B, draftA.draftId, draftA.draftVersion)).toBeNull();
      const done = await stack.engine.service.confirmDraft(USER_ID.A, draftA.draftId, draftA.draftVersion);

      expect(done?.kind).toBe('DONE');
      expect(world.snapshot(USER_ID.A).transactions).toHaveLength(3);
      expect(world.snapshot(USER_ID.B).transactions).toHaveLength(2);
      expect(sessionOf('B', 'WHATSAPP')).toBeDefined();
    });
  });
});
