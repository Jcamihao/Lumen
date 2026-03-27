import { Injectable } from '@nestjs/common';
import { CacheQueueService } from '../cache-queue/cache-queue.service';

export const REMINDERS_QUEUE = 'lumen-reminders';
export const INSIGHTS_QUEUE = 'lumen-insights';
export const FORECASTS_QUEUE = 'lumen-forecasts';

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

  async invalidateDashboard(userId: string) {
    await this.cacheQueueService.del(`dashboard:summary:${userId}`);
  }

  async scheduleReminder(reminderId: string, remindAt: Date) {
    const delay = Math.max(remindAt.getTime() - Date.now(), 0);
    await this.cacheQueueService.enqueue(
      REMINDERS_QUEUE,
      'dispatch-reminder',
      { reminderId },
      { delay },
    );
  }
}
