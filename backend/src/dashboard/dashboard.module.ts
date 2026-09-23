import { Module } from '@nestjs/common';
import { ForecastsModule } from '../forecasts/forecasts.module';
import { InsightsModule } from '../insights/insights.module';
import { RecurringMaterializerModule } from '../recurring-transactions/recurring-materializer.module';
import { InstallmentMaterializerModule } from '../installments/installment-materializer.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [InsightsModule, ForecastsModule, RecurringMaterializerModule, InstallmentMaterializerModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
