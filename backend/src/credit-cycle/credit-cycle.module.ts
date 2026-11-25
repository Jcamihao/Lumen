import { Module } from '@nestjs/common';
import { AccessScopeModule } from '../access-scope/access-scope.module';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { CreditCycleController } from './credit-cycle.controller';
import { CreditCycleService } from './credit-cycle.service';

@Module({
  imports: [AccessScopeModule, LifeEngineModule],
  controllers: [CreditCycleController],
  providers: [CreditCycleService],
  exports: [CreditCycleService],
})
export class CreditCycleModule {}
