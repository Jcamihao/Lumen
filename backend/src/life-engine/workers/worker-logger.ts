import { Logger } from "@nestjs/common";

export const WORKERS_LOG_CONTEXT = "LifeWorkersService";

export function workerLogger() {
  return new Logger(WORKERS_LOG_CONTEXT);
}
