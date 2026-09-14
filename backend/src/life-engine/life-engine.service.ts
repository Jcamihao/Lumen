import { Injectable } from '@nestjs/common';
import { CacheQueueService } from '../cache-queue/cache-queue.service';

export const REMINDERS_QUEUE = 'lumen-reminders';
export const INSIGHTS_QUEUE = 'lumen-insights';
export const FORECASTS_QUEUE = 'lumen-forecasts';
export const PULSE_SCAN_QUEUE = 'lumen-pulse-scan';

@Injectable()
export class LifeEngineService {
  constructor(private readonly cacheQueueService: CacheQueueService) {}

  async touchUserData(userId: string) {
    await Promise.all([
      this.invalidateDashboard(userId),
      this.cacheQueueService.enqueue(INSIGHTS_QUEUE, 'refresh-insights', { userId }),
      this.cacheQueueService.enqueue(FORECASTS_QUEUE, 'refresh-forecast', { userId }),
    ]);
  }

  /**
   * Liga o relogio do pulso do Selah: um job repetivel de hora em hora que
   * varre todos os usuarios e recalcula insights de quem esta na hora local
   * configurada, mesmo sem nenhuma acao do usuario naquele dia. jobId fixo
   * evita duplicar o agendamento a cada reinicio do backend (BullMQ dedupe
   * por jobId dentro do mesmo padrao de repeticao).
   */
  async schedulePulseScan() {
    await this.cacheQueueService.enqueue(
      PULSE_SCAN_QUEUE,
      'scan',
      {},
      { repeat: { pattern: '0 * * * *' }, jobId: 'pulse-scan-hourly' },
    );
  }

  async invalidateDashboard(userId: string) {
    await this.cacheQueueService.del(`dashboard:summary:${userId}`);
  }

  async scheduleReminder(reminderId: string, remindAt: Date) {
    const delay = Math.max(remindAt.getTime() - Date.now(), 0);
    await this.cacheQueueService.enqueue(
      REMINDERS_QUEUE,
      'dispatch-reminder',
      { reminderId },
      // BullMQ recusa ":" em jobId customizado (usa o caractere internamente
      // pra namespacing de chave no Redis) — "Custom Id cannot contain :".
      { delay, jobId: `reminder-${reminderId}` },
    );
  }
}
