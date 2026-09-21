import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateRecurringTransactionDto } from './dto/create-recurring-transaction.dto';
import { UpdateRecurringTransactionDto } from './dto/update-recurring-transaction.dto';
import { RecurringTransactionsService } from './recurring-transactions.service';

@ApiTags('recurring-transactions')
@ApiBearerAuth()
@Controller('recurring-transactions')
export class RecurringTransactionsController {
  constructor(private readonly recurringService: RecurringTransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as contas fixas e recorrentes do usuario' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.recurringService.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma conta fixa/recorrente (gera o lancamento no vencimento)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecurringTransactionDto,
  ) {
    return this.recurringService.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita valor, descricao, categoria, data final ou pausa/retoma' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRecurringTransactionDto,
  ) {
    return this.recurringService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a conta fixa (os lancamentos ja gerados permanecem)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.recurringService.remove(user.sub, id);
  }
}
