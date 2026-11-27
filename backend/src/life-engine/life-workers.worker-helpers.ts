import { Logger } from "@nestjs/common";
import { PULSE_SCAN_QUEUE } from "./life-engine.service";
import { buildService } from "./life-workers.test-helpers";

export const workerCtor = (): jest.Mock =>
  (jest.requireMock("bullmq") as { Worker: jest.Mock }).Worker;

export const resetWorkers = () => workerCtor().mockClear();

export const registeredWorkers = (): any[] =>
  workerCtor().mock.results.map((result) => result.value);

export function workerFor(queue: string): { processor: (job: any) => Promise<unknown> } {
  const worker = registeredWorkers().find((candidate) => candidate.queue === queue);
  if (!worker) throw new Error(`worker ${queue} nao registrado`);
  return worker;
}

export function captureLogs() {
  const logs: unknown[][] = [];
  const spies = (["log", "warn"] as const).map((level) =>
    jest
      .spyOn(Logger.prototype, level)
      .mockImplementation(function (this: { context?: string }, message: string) {
        logs.push([level, this.context, message]);
      }),
  );
  return { logs, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

export async function runPulse(now: Date, configure: (deps: ReturnType<typeof buildService>["deps"]) => void) {
  jest.setSystemTime(now);
  const { service, deps } = buildService();
  configure(deps);
  const captured = captureLogs();
  await service.onModuleInit();
  await workerFor(PULSE_SCAN_QUEUE).processor({});
  captured.restore();
  return { deps, logs: captured.logs };
}
