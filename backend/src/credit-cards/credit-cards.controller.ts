import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { SetSharingDto } from '../access-scope/dto/set-sharing.dto';
import { SetCreditCycleCeilingDto } from '../credit-cycle/dto/set-credit-cycle-ceiling.dto';
import { CreditCardsService } from './credit-cards.service';
import { CreateCreditCardDto } from './dto/create-credit-card.dto';
import { ListCreditCardsQueryDto } from './dto/list-credit-cards.query.dto';
import { UpdateCreditCardDto } from './dto/update-credit-card.dto';

@ApiTags('credit-cards')
@ApiBearerAuth()
@Controller('credit-cards')
export class CreditCardsController {
  constructor(private readonly creditCards: CreditCardsService) {}

  @Get()
  @ApiOperation({ summary: 'Cartoes (ativos; scope shared/all traz os cartoes compartilhados do grupo; includeArchived=true traz o historico)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCreditCardsQueryDto) {
    return this.creditCards.list(user.sub, query.includeArchived === 'true', query.scope ?? 'mine');
  }

  @Post()
  @ApiOperation({ summary: 'Cria um cartao nomeado (nao padrao). Devolve recibo.' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCreditCardDto) {
    return this.creditCards.create(user.sub, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Um cartao do usuario (404 para cartao alheio)' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.creditCards.get(user.sub, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Altera nome, fechamento, vencimento ou countAllPayments (este so no padrao). Devolve recibo.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCreditCardDto,
  ) {
    return this.creditCards.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Arquiva o cartao (nao apaga; o padrao nao arquiva). Devolve recibo.' })
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.creditCards.archive(user.sub, id);
  }

  @Post(':id/make-default')
  @ApiOperation({ summary: 'Promove o cartao a padrao (espelha no User na mesma transacao). Devolve recibo.' })
  makeDefault(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.creditCards.makeDefault(user.sub, id);
  }

  @Patch(':id/sharing')
  @ApiOperation({ summary: 'Marca/desmarca o cartao para o grupo Compartilhado (so o autor; arquivado: 409). Devolve recibo (id, isShared, updatedAt).' })
  setSharing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetSharingDto,
  ) {
    return this.creditCards.setSharing(user.sub, id, dto.shared);
  }

  @Get(':id/cycle')
  @ApiOperation({ summary: 'Ciclo aberto do cartao (mesma forma de /credit-cycle/current)' })
  cycle(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.creditCards.cycle(user.sub, id);
  }

  @Delete(':id/ceiling')
  @ApiOperation({
    summary: 'Limpa o teto do ciclo aberto do cartao. Devolve recibo (cardId, id, removedCents, cycleStart, cycleEnd, refreshPending). Sem teto vigente: 409.',
  })
  clearCeiling(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.creditCards.clearCeiling(user.sub, id);
  }

  @Put(':id/ceiling')
  @ApiOperation({ summary: 'Define o teto do ciclo aberto do cartao. Devolve recibo (cardId, id, ceilingCents, ciclo, refreshPending).' })
  setCeiling(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetCreditCycleCeilingDto,
  ) {
    return this.creditCards.setCeiling(user.sub, id, dto);
  }
}
