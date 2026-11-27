const createWorker = jest.fn();
jest.mock('tesseract.js', () => ({ createWorker: (...args: unknown[]) => createWorker(...args) }));

import { createOcrWorker } from './ocr-worker.factory';

describe('createOcrWorker', () => {
  const worker = { setParameters: jest.fn(), terminate: jest.fn() };

  beforeEach(() => {
    worker.setParameters.mockReset().mockResolvedValue(undefined);
    worker.terminate.mockReset().mockResolvedValue(undefined);
    createWorker.mockReset().mockResolvedValue(worker);
  });

  it('cria worker em português, sem cache em disco, com segmentação por bloco', async () => {
    await expect(createOcrWorker()).resolves.toBe(worker);
    expect(createWorker).toHaveBeenCalledWith(
      'por',
      1,
      expect.objectContaining({ gzip: true, cacheMethod: 'none', langPath: expect.any(String) }),
    );
    expect(worker.setParameters).toHaveBeenCalledWith({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });
  });

  it('worker que não configura é terminado e o erro original sobe', async () => {
    worker.setParameters.mockRejectedValue(new Error('config'));
    await expect(createOcrWorker()).rejects.toThrow('config');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
