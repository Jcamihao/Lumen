import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { WhatsappLinkService, hashLinkCode, looksLikeLinkCode, normalizeLinkCode } from './whatsapp-link.service';

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
    whatsappLink: {
      findUnique: jest.fn(async ({ where }: { where: Row }) => links.find((row) => matches(row, where)) ?? null),
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (links.some((row) => row.jid === data.jid)) throw uniqueFail(['jid']);
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
    whatsappLinkCode: {
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
        for (let i = codes.length - 1; i >= 0; i -= 1) if (matches(codes[i], where)) codes.splice(i, 1);
        return { count: 0 };
      }),
    },
    conversationSession: {
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        for (let i = sessions.length - 1; i >= 0; i -= 1) if (matches(sessions[i], where)) sessions.splice(i, 1);
        return { count: 0 };
      }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return db;
}

function buildService(enabled = true, extra: Record<string, unknown> = {}) {
  const db = buildDb();
  const config = {
    get: (key: string) => {
      const values: Record<string, unknown> = {
        'whatsapp.enabled': enabled,
        'whatsapp.contactNumber': '5511900000000',
        ...extra,
      };
      return values[key];
    },
  } as unknown as ConfigService;
  const service = new WhatsappLinkService(db as never, config);
  return { db, service };
}

const JID_A = '5511999990000@s.whatsapp.net';
const JID_B = '5521988887777@s.whatsapp.net';

describe('WhatsappLinkService', () => {
  it('codigo certo vincula e marca como usado', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');
    expect(await service.redeem(JID_A, code)).toBe(true);
    expect(db.links).toHaveLength(1);
    expect(db.codes[0].usedAt).toBeInstanceOf(Date);
  });

  it('codigo digitado com espacos e hifen e minusculas ainda vale', async () => {
    const { service } = buildService();
    const { code } = await service.createCode('A');
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`;
    expect(await service.redeem(JID_A, typed)).toBe(true);
  });

  it('codigo errado, de outro formato, expirado e ja usado: false', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');
    expect(await service.redeem(JID_A, 'ZZZZZZZZ')).toBe(false);
    expect(await service.redeem(JID_A, 'curto')).toBe(false);
    expect(await service.redeem(JID_A, '0OIL1IIO')).toBe(false);
    db.codes[0].expiresAt = new Date(Date.now() - 1);
    expect(await service.redeem(JID_A, code)).toBe(false);
    db.codes[0].expiresAt = new Date(Date.now() + 60_000);
    expect(await service.redeem(JID_A, code)).toBe(true);
    expect(await service.redeem(JID_B, code)).toBe(false);
  });

  it('usado duas vezes em paralelo: so um vincula', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');
    const results = await Promise.all([service.redeem(JID_A, code), service.redeem(JID_B, code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(db.links).toHaveLength(1);
  });

  it('leitura velha de codigo ja usado (corrida): o consumo condicional recusa e nada e vinculado', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');
    expect(await service.redeem(JID_A, code)).toBe(true);
    await service.unlinkByUserId('A');
    const stale = { ...db.codes[0], usedAt: null };
    db.whatsappLinkCode.findFirst.mockResolvedValueOnce(stale);
    expect(await service.redeem(JID_B, code)).toBe(false);
    expect(db.links).toHaveLength(0);
  });

  it('leitura velha de codigo expirado (corrida): o consumo condicional recusa e nada e vinculado', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');
    db.codes[0].expiresAt = new Date(Date.now() - 1);
    db.whatsappLinkCode.findFirst.mockResolvedValueOnce({ ...db.codes[0] });
    expect(await service.redeem(JID_A, code)).toBe(false);
    expect(db.links).toHaveLength(0);
  });

  it('jid ja vinculado a outra conta: false, sem vinculo novo, codigo fica consumido', async () => {
    const { db, service } = buildService();
    db.links.push({ id: 'x', userId: 'OUTRA', jid: JID_A, linkedAt: new Date() });
    const { code } = await service.createCode('B');
    expect(await service.redeem(JID_A, code)).toBe(false);
    expect(db.links).toHaveLength(1);
    expect(db.whatsappLink.create).not.toHaveBeenCalled();
    expect(db.codes[0].usedAt).toBeInstanceOf(Date);
    expect(await service.redeem(JID_B, code)).toBe(false);
  });

  it('conta do codigo ja vinculada a outro jid: false, nem tenta criar, codigo consumido', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('B');
    db.links.push({ id: 'x', userId: 'B', jid: JID_A, linkedAt: new Date() });
    expect(await service.redeem(JID_B, code)).toBe(false);
    expect(db.whatsappLink.create).not.toHaveBeenCalled();
    expect(db.links).toHaveLength(1);
    expect(db.codes[0].usedAt).toBeInstanceOf(Date);
  });

  it('violacao de unicidade na criacao (corrida entre a checagem e o create): false, sem lancar', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');
    db.whatsappLink.create.mockRejectedValueOnce(Object.assign(new Error('Unique'), { code: 'P2002' }));
    await expect(service.redeem(JID_A, code)).resolves.toBe(false);
    expect(db.links).toHaveLength(0);
  });

  it('erro de banco que nao e unicidade sobe (nao vira "codigo invalido")', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');
    db.whatsappLink.create.mockRejectedValueOnce(new Error('conexao caiu'));
    await expect(service.redeem(JID_A, code)).rejects.toThrow('conexao caiu');
  });

  it('usuario ja vinculado recebe 409 ao pedir codigo', async () => {
    const { db, service } = buildService();
    db.links.push({ id: 'x', userId: 'A', jid: JID_A, linkedAt: new Date() });
    await expect(service.createCode('A')).rejects.toMatchObject({ status: 409 });
  });

  it('createCode com recurso desligado: 503', async () => {
    const { service } = buildService(false);
    await expect(service.createCode('A')).rejects.toMatchObject({ status: 503 });
  });

  it('codigo novo invalida o anterior', async () => {
    const { service } = buildService();
    const first = await service.createCode('A');
    await service.createCode('A');
    expect(await service.redeem(JID_A, first.code)).toBe(false);
  });

  it('so o hash vai ao banco; o codigo em claro nao aparece em nenhuma chamada', async () => {
    const { db, service } = buildService();
    const { code } = await service.createCode('A');
    const stored = db.codes[0].codeHash;
    expect(stored).toBe(createHash('sha256').update(code).digest('hex'));
    expect(JSON.stringify(db.whatsappLinkCode.create.mock.calls)).not.toContain(code);
    expect(JSON.stringify(db.whatsappLinkCode.findFirst.mock.calls)).not.toContain(code);
  });

  it('unlinkByUserId apaga vinculo e sessao WHATSAPP, nao a APP, e e idempotente', async () => {
    const { db, service } = buildService();
    db.links.push({ id: 'x', userId: 'A', jid: JID_A, linkedAt: new Date() });
    db.sessions.push({ userId: 'A', channel: 'WHATSAPP' }, { userId: 'A', channel: 'APP' });
    await service.unlinkByUserId('A');
    expect(db.links).toHaveLength(0);
    expect(db.sessions).toEqual([{ userId: 'A', channel: 'APP' }]);
    await expect(service.unlinkByUserId('A')).resolves.toBeUndefined();
  });

  it('findUserIdByJid devolve so o dono do jid pedido; jid sem vinculo = null', async () => {
    const { db, service } = buildService();
    db.links.push(
      { id: 'x', userId: 'A', jid: JID_A, linkedAt: new Date() },
      { id: 'y', userId: 'B', jid: JID_B, linkedAt: new Date() },
    );
    expect(await service.findUserIdByJid(JID_B)).toBe('B');
    expect(await service.findUserIdByJid(JID_A)).toBe('A');
    expect(await service.findUserIdByJid('5511000000000@s.whatsapp.net')).toBeNull();
  });

  it('getStatus mascara o numero e nunca devolve o jid inteiro', async () => {
    const { db, service } = buildService();
    db.links.push({ id: 'x', userId: 'A', jid: JID_A, linkedAt: new Date() });
    const status = await service.getStatus('A');
    expect(status).toMatchObject({ enabled: true, linked: true, maskedNumber: '+55 11 *****-0000', contactNumber: '5511900000000' });
    expect(JSON.stringify(status)).not.toContain('5511999990000');
  });

  it('getStatus com recurso desligado nao devolve contactNumber', async () => {
    const { service } = buildService(false);
    const status = await service.getStatus('A');
    expect(status).toEqual({ enabled: false, linked: false });
  });

  it('boot com enabled e variavel faltando lanca com os nomes, sem valores', () => {
    const { service } = buildService(true, { 'whatsapp.waAkgBaseUrl': 'http://segredo-valor', 'whatsapp.waAkgApiKey': '', 'whatsapp.waAkgSessionId': 's', 'whatsapp.waAkgWebhookSecret': '' });
    let message = '';
    try {
      service.onModuleInit();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('WA_AKG_API_KEY');
    expect(message).toContain('WA_AKG_WEBHOOK_SECRET');
    expect(message).not.toContain('segredo-valor');
  });

  it('helpers de codigo', () => {
    expect(normalizeLinkCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(looksLikeLinkCode('ABCD-EFG')).toBe(false);
    expect(looksLikeLinkCode('ABCD-EFGH')).toBe(true);
    expect(looksLikeLinkCode('ABCD-2345')).toBe(true);
    expect(looksLikeLinkCode('ABCD0OIL')).toBe(false);
    expect(hashLinkCode('ABCDEFGH')).toHaveLength(64);
  });
});
