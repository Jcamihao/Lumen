import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { EnvelopesController } from './envelopes.controller';
import { EnvelopesService } from './envelopes.service';

@Module({
  imports: [BillingModule, LifeEngineModule],
  controllers: [EnvelopesController],
  providers: [EnvelopesService],
  exports: [EnvelopesService],
})
export class EnvelopesModule {}
