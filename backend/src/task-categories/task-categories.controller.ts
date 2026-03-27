import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateTaskCategoryDto } from './dto/create-task-category.dto';
import { UpdateTaskCategoryDto } from './dto/update-task-category.dto';
import { TaskCategoriesService } from './task-categories.service';

@ApiTags('task-categories')
@ApiBearerAuth()
@Controller('task-categories')
export class TaskCategoriesController {
  constructor(private readonly taskCategoriesService: TaskCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista categorias de tarefa do usuario' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.taskCategoriesService.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Cria categoria de tarefa' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaskCategoryDto) {
    return this.taskCategoriesService.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza categoria de tarefa' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskCategoryDto,
  ) {
    return this.taskCategoriesService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove categoria de tarefa' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.taskCategoriesService.remove(user.sub, id);
  }
}
