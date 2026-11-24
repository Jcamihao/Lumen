import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AcceptGroupInviteDto } from './dto/accept-group-invite.dto';
import { CreateGroupInviteDto } from './dto/create-group-invite.dto';
import { GroupService } from './group.service';

/**
 * Grupo do plano Compartilhado (contrato 11, 11a). Rotas autenticadas: identidade sempre
 * do token (D12); quem gerencia e decidido no GroupService, nunca no cliente.
 */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing/group')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @Get()
  @ApiOperation({ summary: 'Visao do grupo: pagador ve membros/convites; membro so o primeiro nome do pagador' })
  getGroup(@CurrentUser() user: AuthenticatedUser) {
    return this.groupService.getGroup(user.sub);
  }

  @Post('invites')
  @ApiOperation({ summary: 'Cria convite (so o pagador; o token em claro so aparece nesta resposta)' })
  createInvite(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGroupInviteDto) {
    return this.groupService.createInvite(user.sub, dto);
  }

  @Delete('invites/:id')
  @ApiOperation({ summary: 'Revoga convite pendente (so o pagador)' })
  revokeInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.groupService.revokeInvite(user.sub, id);
  }

  @Post('invite/accept')
  @ApiOperation({ summary: 'Aceita convite (logado com o mesmo e-mail do convite)' })
  acceptInvite(@CurrentUser() user: AuthenticatedUser, @Body() dto: AcceptGroupInviteDto) {
    return this.groupService.acceptInvite(user.sub, dto.token);
  }

  @Post('leave')
  @ApiOperation({ summary: 'Saida do membro do proprio grupo' })
  leave(@CurrentUser() user: AuthenticatedUser) {
    return this.groupService.leave(user.sub);
  }

  @Delete('members/:id')
  @ApiOperation({ summary: 'Remove membro (so o pagador)' })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.groupService.removeMember(user.sub, id);
  }
}
