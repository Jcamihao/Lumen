import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';
import { ListSupportRequestsDto } from './dto/list-support-requests.dto';
import { UpdateSupportRequestStatusDto } from './dto/update-support-request-status.dto';
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
  listAll(@Query() query: ListSupportRequestsDto) {
    return this.supportRequestsService.listAll({
      status: query.status,
      type: query.type,
      page: query.page ?? 1,
    });
  }

  @Get('admin/feedback-summary')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '[Admin] Resumo do feedback dos testadores (nota media, distribuicao, areas)' })
  feedbackSummary() {
    return this.supportRequestsService.feedbackSummary();
  }

  @Patch('admin/:id/status')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '[Admin] Atualiza o status de uma solicitacao de suporte' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSupportRequestStatusDto,
  ) {
    return this.supportRequestsService.updateStatus(id, dto.status);
  }
}
