const createOcrWorker = jest.fn();
jest.mock('./ocr-worker.factory', () => ({ createOcrWorker: () => createOcrWorker() }));

import { OcrPool } from './ocr-pool';
import { OcrTimeoutError } from './ocr-timeout.error';

const NEVER = new Promise<never>(() => undefined);
const fakeWorker = (recognize: () => Promise<unknown>) => ({
  recognize: jest.fn(recognize),
  terminate: jest.fn(async () => undefined),
});
const okWorker = () => fakeWorker(async () => ({ data: { text: 'ok', confidence: 90 } }));
const png = Buffer.alloc(1);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('OcrPool (worker simulado)', () => {
  beforeEach(() => createOcrWorker.mockReset());

  it('não deixa timer pendente depois de uma leitura boa', async () => {
    jest.useFakeTimers();
    try {
      createOcrWorker.mockResolvedValue(okWorker());
      await new OcrPool().recognize(png, 30_000);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('prazo vencido enquanto o worker nasce devolve o worker ao pool para reuso', async () => {
    const pool = new OcrPool();
    const worker = okWorker();
    let finishCreation!: (w: unknown) => void;
    createOcrWorker.mockReturnValueOnce(new Promise((resolve) => (finishCreation = resolve)));
    await expect(pool.recognize(png, 20)).rejects.toBeInstanceOf(OcrTimeoutError);
    finishCreation(worker);
    await pause(20);

    createOcrWorker.mockRejectedValue(new Error('não devia criar outro'));
    await expect(pool.recognize(png, 1000)).resolves.toEqual({ text: 'ok', confidence: 90 });
    expect(worker.recognize).toHaveBeenCalledTimes(1);
  });

  it('nunca cria mais de 2 workers', async () => {
    const pool = new OcrPool();
    createOcrWorker.mockImplementation(async () => fakeWorker(() => NEVER));
    const reads = [1, 2, 3].map(() => pool.recognize(png, 150).catch(() => undefined));
    await pause(50);
    expect(createOcrWorker).toHaveBeenCalledTimes(2);
    await Promise.all(reads);
  });

  it('falha ao criar worker acorda quem espera vaga', async () => {
    const pool = new OcrPool();
    createOcrWorker
      .mockImplementationOnce(async () => {
        await pause(10);
        throw new Error('sem worker');
      })
      .mockImplementationOnce(async () => fakeWorker(() => NEVER))
      .mockImplementationOnce(async () => okWorker());

    const first = pool.recognize(png, 400).catch((e) => e);
    const second = pool.recognize(png, 400).catch((e) => e);
    const third = pool.recognize(png, 400);
    const outcome = await Promise.race([third, pause(250).then(() => 'travou')]);

    expect(outcome).toEqual({ text: 'ok', confidence: 90 });
    expect((await first).message).toBe('sem worker');
    expect(await second).toBeInstanceOf(OcrTimeoutError);
  });

  it('worker que estoura o prazo é terminado e sai do pool', async () => {
    const pool = new OcrPool();
    const slow = fakeWorker(() => NEVER);
    createOcrWorker.mockResolvedValue(slow);
    await expect(pool.recognize(png, 30)).rejects.toBeInstanceOf(OcrTimeoutError);
    expect(slow.terminate).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);
  });
});
