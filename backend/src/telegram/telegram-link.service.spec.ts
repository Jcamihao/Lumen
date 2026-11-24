import { ConfigService } from '@nestjs/config';
import { TelegramLinkService } from './telegram-link.service';

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && 'gt' in expected) return row[key] > expected.gt;
    return row[key] === expected;
  });
}

function buildDb() {
  const links: Row[] = [];
  const codes: Row[] = [];
  const sessions: Row[] = [];
  let seq = 0;
  const uniqueFail = (target: string[]) => Object.assign(new Error('Unique'), { code: 'P2002', meta: { target } });
  const db = {
    links,
    codes,
    sessions,
    telegramLink: {
      findUnique: jest.fn(async ({ where }: { where: Row }) => links.find((row) => matches(row, where)) ?? null),
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (links.some((row) => row.chatId === data.chatId)) throw uniqueFail(['chatId']);
        if (links.some((row) => row.userId === data.userId)) throw uniqueFail(['userId']);
        const row = { id: `l${++seq}`, linkedAt: new Date(), ...data };
        links.push(row);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = links.length;
        for (let i = links.length - 1; i >= 0; i -= 1) if (matches(links[i], where)) links.splice(i, 1);
        return { count: before - links.length };
      }),
    },
    telegramLinkCode: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: `c${++seq}`, usedAt: null, ...data };
        codes.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: Row }) => codes.find((row) => matches(row, where)) ?? null),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const targets = codes.filter((row) => matches(row, where));
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      }),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = codes.length;
        for (let i = codes.length - 1; i >= 0; i -= 1) if (matches(codes[i], where)) codes.splice(i, 1);
        return { count: before - codes.length };
      }),
    },
    conversationSession: {
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = sessions.length;
        for (let i = sessions.length - 1; i >= 0; i -= 1) if (matches(sessions[i], where)) sessions.splice(i, 1);
        return { count: before - sessions.length };
      }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return db;
}

function buildService(enabled = true) {
  const db = buildDb();
  const config = { get: (key: string) => (key === 'telegram.enabled' ? enabled : undefined) } as unknown as ConfigService;
  return { db, service: new TelegramLinkService(db as never, config) };
}

const CHAT_A = '111222333';
const CHAT_B = '999888777';

describe('TelegramLinkService (contrato 10, D1)', () => {
  it('codigo certo vincula o chat e marca o codigo como usado', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');

    expect(await service.redeem(CHAT_A, code)).toBe(true);
    expect(db.links).toEqual([expect.objectContaining({ userId: 'A', chatId: BigInt(CHAT_A) })]);
    expect(db.codes[0].usedAt).toBeInstanceOf(Date);
  });

  it('codigo digitado com espacos, hifen e minusculas ainda vale', async () => {
    const { service } = buildService();
    const { code } = await service.createCode('A');
    expect(await service.redeem(CHAT_A, `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`)).toBe(true);
  });

  it('so um chat por conta e um dono por chat; tentativa recusada consome o codigo', async () => {
    const { db, service } = buildService();
    const first = await service.createCode('A');
    expect(await service.redeem(CHAT_A, first.code)).toBe(true);

    const second = await service.createCode('B').catch(() => null);
    expect(second).not.toBeNull();
    expect(await service.redeem(CHAT_A, second!.code)).toBe(false);
    expect(db.codes.find((c) => c.codeHash.length === 64 && c.usedAt === null)).toBeUndefined();
  });

  it('gerar codigo novo invalida o anterior ainda nao usado', async () => {
    const { db, service } = buildService();
    const old = await service.createCode('A');
    const fresh = await service.createCode('A');
    expect(await service.redeem(CHAT_A, old.code)).toBe(false);
    expect(await service.redeem(CHAT_A, fresh.code)).toBe(true);
    expect(db.codes.filter((c) => c.usedAt === null)).toHaveLength(0);
  });

  it('codigo expirado nao vincula', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');
    db.codes[0].expiresAt = new Date(Date.now() - 1000);
    expect(await service.redeem(CHAT_A, code)).toBe(false);
    expect(db.links).toHaveLength(0);
  });

  it('com canal desligado, criar codigo responde 503 e resgate nao roda', async () => {
    const { service } = buildService(false);
    await expect(service.createCode('A')).rejects.toMatchObject({ getStatus: expect.any(Function) });
    expect(await service.redeem(CHAT_A, 'ABC2DEFG')).toBe(false);
  });

  it('status: sem vinculo so flags; com vinculo, chat mascarado (nunca o id inteiro)', async () => {
    const { service } = buildService();
    expect(await service.getStatus('A')).toEqual({ enabled: true, linked: false });

    const { code } = await service.createCode('A');
    await service.redeem(CHAT_A, code);
    const status = await service.getStatus('A');
    expect(status).toMatchObject({ linked: true, maskedChatId: '11•••••33' });
    expect(JSON.stringify(status)).not.toContain(CHAT_A);
  });

  it('desvincular apaga o vinculo e a sessao TELEGRAM (e so ela)', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');
    await service.redeem(CHAT_A, code);
    db.sessions.push({ userId: 'A', channel: 'TELEGRAM', id: 's1' });
    db.sessions.push({ userId: 'A', channel: 'APP', id: 's2' });

    await service.unlinkByUserId('A');

    expect(db.links).toHaveLength(0);
    expect(db.sessions.map((s) => s.id)).toEqual(['s2']);
  });

  it('chatId em forma impossivel nao acha dono nem vincula', async () => {
    const { service } = buildService();
    await service.createCode('A');
    expect(await service.findUserIdByChatId('-5')).toBeNull();
    expect(await service.findUserIdByChatId('abc')).toBeNull();
    expect(await service.redeem('abc', 'ABC2DEFG')).toBe(false);
  });
});
