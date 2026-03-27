import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ForecastsService } from './forecasts.service';

@ApiTags('forecasts')
@ApiBearerAuth()
@Controller('forecasts')
export class ForecastsController {
  constructor(private readonly forecastsService: ForecastsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Retorna a previsao financeira atual' })
  current(@CurrentUser() user: AuthenticatedUser) {
    return this.forecastsService.getCurrent(user.sub);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Recalcula a previsao financeira' })
  refresh(@CurrentUser() user: AuthenticatedUser) {
    return this.forecastsService.recalculateForUser(user.sub);
  }
}
