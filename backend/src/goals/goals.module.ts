import { Module } from '@nestjs/common';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [LifeEngineModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
