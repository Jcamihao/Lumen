import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { RemindersService } from './reminders.service';

@ApiTags('reminders')
@ApiBearerAuth()
@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  @ApiOperation({ summary: 'Lista lembretes do usuario' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.remindersService.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Cria lembrete integrado com tarefas, metas ou contas' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReminderDto) {
    return this.remindersService.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza lembrete' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
  ) {
    return this.remindersService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove lembrete' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.remindersService.remove(user.sub, id);
  }
}
