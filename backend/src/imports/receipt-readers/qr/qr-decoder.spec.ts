const calls = { widths: [] as Array<number | undefined>, flatten: [] as unknown[], toBuffer: jest.fn() };
const jsQr = jest.fn();

jest.mock('jsqr', () => (...args: unknown[]) => jsQr(...args));
jest.mock('../image/sharp-loader', () => ({
  sharp: () => {
    const chain: Record<string, unknown> = {};
    chain.flatten = (arg: unknown) => (calls.flatten.push(arg), chain);
    chain.resize = ({ width }: { width: number }) => (calls.widths.push(width), chain);
    chain.ensureAlpha = () => chain;
    chain.raw = () => chain;
    chain.toBuffer = () => calls.toBuffer();
    return chain;
  },
}));

import { decodeQr } from './qr-decoder';

describe('decodeQr (sharp e jsqr simulados)', () => {
  beforeEach(() => {
    calls.widths.length = 0;
    calls.flatten.length = 0;
    calls.toBuffer.mockReset().mockResolvedValue({ data: Buffer.alloc(4), info: { width: 1, height: 1 } });
    jsQr.mockReset().mockReturnValue(null);
  });

  it('tenta original, 900, 1400 e 600 nessa ordem, sobre fundo branco', async () => {
    await expect(decodeQr(Buffer.alloc(1))).resolves.toBeNull();
    expect(calls.widths).toEqual([900, 1400, 600]);
    expect(calls.flatten).toEqual(Array(4).fill({ background: '#ffffff' }));
  });

  it('tenta as duas polaridades do QR', async () => {
    await decodeQr(Buffer.alloc(1));
    expect(jsQr).toHaveBeenCalledWith(expect.anything(), 1, 1, { inversionAttempts: 'attemptBoth' });
  });

  it('erro de imagem vira null e não lança', async () => {
    calls.toBuffer.mockRejectedValue(new Error('imagem ruim'));
    await expect(decodeQr(Buffer.alloc(1))).resolves.toBeNull();
  });

  it('devolve o texto do primeiro QR achado e para', async () => {
    jsQr.mockReturnValueOnce(null).mockReturnValueOnce({ data: 'https://qr' });
    await expect(decodeQr(Buffer.alloc(1))).resolves.toBe('https://qr');
    expect(calls.widths).toEqual([900]);
  });
});
