import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateEnvelopeDto } from './dto/create-envelope.dto';
import { UpdateEnvelopeDto } from './dto/update-envelope.dto';
import { EnvelopesService } from './envelopes.service';

@ApiTags('envelopes')
@ApiBearerAuth()
@Controller('envelopes')
export class EnvelopesController {
  constructor(private readonly envelopesService: EnvelopesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os envelopes do usuario, com o saldo disponivel de cada um' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.envelopesService.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Cria um envelope (valor reservado que recarrega todo mes)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEnvelopeDto) {
    return this.envelopesService.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita nome, valor mensal, ou pausa/retoma um envelope' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEnvelopeDto,
  ) {
    return this.envelopesService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove o envelope (as transacoes ja marcadas com ele permanecem)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.envelopesService.remove(user.sub, id);
  }
}
