import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { InsightsService } from './insights.service';

@ApiTags('insights')
@ApiBearerAuth()
@Controller('insights')
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista insights atuais do usuario' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.insightsService.list(user.sub);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Reprocessa o motor de regras de insights' })
  refresh(@CurrentUser() user: AuthenticatedUser) {
    return this.insightsService.refreshForUser(user.sub);
  }
}
