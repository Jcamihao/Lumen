import { Global, Module } from '@nestjs/common';
import { CacheQueueService } from './cache-queue.service';

@Global()
@Module({
  providers: [CacheQueueService],
  exports: [CacheQueueService],
})
export class CacheQueueModule {}
