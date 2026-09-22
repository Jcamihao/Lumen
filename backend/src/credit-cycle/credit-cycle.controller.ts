import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreditCycleService } from './credit-cycle.service';
import { SetCreditCycleCeilingDto } from './dto/set-credit-cycle-ceiling.dto';
import { UpdateCreditCycleSettingsDto } from './dto/update-credit-cycle-settings.dto';

@ApiTags('credit-cycle')
@ApiBearerAuth()
@Controller('credit-cycle')
export class CreditCycleController {
  constructor(private readonly creditCycleService: CreditCycleService) {}

  @Get('current')
  @ApiOperation({ summary: 'Ciclo de credito aberto agora: teto, gasto e quanto falta' })
  getCurrent(@CurrentUser() user: AuthenticatedUser) {
    return this.creditCycleService.getCurrent(user.sub);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Define o dia de vencimento da fatura (o de fechamento fica em /users/me)' })
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCreditCycleSettingsDto,
  ) {
    return this.creditCycleService.updateSettings(user.sub, dto);
  }

  @Put('ceiling')
  @ApiOperation({ summary: 'Define o teto do ciclo de credito aberto agora' })
  setCeiling(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetCreditCycleCeilingDto) {
    return this.creditCycleService.setCeiling(user.sub, dto);
  }
}
