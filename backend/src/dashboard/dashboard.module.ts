import { Module } from '@nestjs/common';
import { ForecastsModule } from '../forecasts/forecasts.module';
import { InsightsModule } from '../insights/insights.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [InsightsModule, ForecastsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
