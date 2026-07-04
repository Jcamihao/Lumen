import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupportRequestStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';
import { SupportRequestsService } from './support-requests.service';

@ApiTags('support-requests')
@ApiBearerAuth()
@Controller('support-requests')
export class SupportRequestsController {
  constructor(
    private readonly supportRequestsService: SupportRequestsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista solicitacoes de suporte do usuario' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.supportRequestsService.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma solicitacao de suporte' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupportRequestDto,
  ) {
    return this.supportRequestsService.create(user.sub, user.email, dto);
  }

  @Get('admin')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '[Admin] Lista todas as solicitacoes de suporte' })
  listAll(
    @Query('status') status?: SupportRequestStatus,
    @Query('page') page?: string,
  ) {
    return this.supportRequestsService.listAll({
      status,
      page: page ? Number(page) : 1,
    });
  }

  @Patch('admin/:id/status')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '[Admin] Atualiza o status de uma solicitacao de suporte' })
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: SupportRequestStatus,
  ) {
    return this.supportRequestsService.updateStatus(id, status);
  }
}
