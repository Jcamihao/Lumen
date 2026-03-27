import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ContributeGoalDto } from './dto/contribute-goal.dto';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { GoalsService } from './goals.service';

@ApiTags('goals')
@ApiBearerAuth()
@Controller('goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista metas do usuario' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.goalsService.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Cria meta financeira ou de vida' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGoalDto) {
    return this.goalsService.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza meta' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goalsService.update(user.sub, id, dto);
  }

  @Patch(':id/contribute')
  @ApiOperation({ summary: 'Registra progresso de uma meta' })
  contribute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ContributeGoalDto,
  ) {
    return this.goalsService.contribute(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove meta' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.goalsService.remove(user.sub, id);
  }
}
