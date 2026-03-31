import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
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
}
