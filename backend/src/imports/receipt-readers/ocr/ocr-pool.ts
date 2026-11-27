import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Worker } from 'tesseract.js';
import { OcrDeadline, startOcrDeadline } from './ocr-deadline';
import { createOcrWorker } from './ocr-worker.factory';
import { OcrTimeoutError } from './ocr-timeout.error';
import type { OcrResult } from './ocr.types';

const OCR_MAX_WORKERS = 2;

type WorkerSlot = { worker: Worker | null };

/**
 * Pool de até 2 workers do tesseract (portugues, dado local, sem cache em disco).
 * Um worker que estoura o tempo é terminado e sai do pool; o pool recria sob demanda.
 */
@Injectable()
export class OcrPool implements OnModuleDestroy {
  private readonly idle: Worker[] = [];
  private readonly all = new Set<Worker>();
  private readonly waiters: Array<() => void> = [];
  private creating = 0;

  get size() {
    return this.all.size;
  }

  async recognize(png: Buffer, timeoutMs: number): Promise<OcrResult> {
    const deadline = startOcrDeadline(timeoutMs);
    const slot: WorkerSlot = { worker: null };
    const work = this.recognizeWithin(png, deadline, slot);

    try {
      const result = await Promise.race([work, deadline.promise]);
      this.release(slot.worker!);
      return result;
    } catch (error) {
      if (slot.worker) {
        await this.discard(slot.worker);
      }
      throw error;
    } finally {
      deadline.clear();
    }
  }

  async onModuleDestroy() {
    const workers = [...this.all];
    this.all.clear();
    this.idle.length = 0;
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined)));
  }

  private async recognizeWithin(
    png: Buffer,
    deadline: OcrDeadline,
    slot: WorkerSlot,
  ): Promise<OcrResult> {
    const acquired = await this.acquire();
    if (deadline.hasPassed()) {
      // O prazo acabou enquanto esperávamos worker: devolve o worker ao pool.
      this.release(acquired);
      throw new OcrTimeoutError();
    }
    slot.worker = acquired;
    const { data } = await acquired.recognize(png);
    return { text: data.text, confidence: data.confidence };
  }

  private async acquire(): Promise<Worker> {
    for (;;) {
      const idle = this.idle.pop();
      if (idle) {
        return idle;
      }
      if (this.all.size + this.creating < OCR_MAX_WORKERS) {
        return this.spawn();
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private async spawn(): Promise<Worker> {
    this.creating++;
    try {
      const worker = await createOcrWorker();
      this.all.add(worker);
      return worker;
    } catch (error) {
      this.wake();
      throw error;
    } finally {
      this.creating--;
    }
  }

  private release(worker: Worker) {
    this.idle.push(worker);
    this.wake();
  }

  private async discard(worker: Worker) {
    this.all.delete(worker);
    const index = this.idle.indexOf(worker);
    if (index >= 0) {
      this.idle.splice(index, 1);
    }
    await worker.terminate().catch(() => undefined);
    this.wake();
  }

  private wake() {
    this.waiters.shift()?.();
  }
}
