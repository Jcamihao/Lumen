import { Module } from '@nestjs/common';
import { AccessScopeModule } from '../access-scope/access-scope.module';
import { LifeEngineModule } from '../life-engine/life-engine.module';
import { FinanceCategoriesController } from './finance-categories.controller';
import { FinanceCategoriesService } from './finance-categories.service';

@Module({
  imports: [LifeEngineModule, AccessScopeModule],
  controllers: [FinanceCategoriesController],
  providers: [FinanceCategoriesService],
  exports: [FinanceCategoriesService],
})
export class FinanceCategoriesModule {}
