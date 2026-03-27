import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateFinanceCategoryDto } from './dto/create-finance-category.dto';
import { UpdateFinanceCategoryDto } from './dto/update-finance-category.dto';
import { FinanceCategoriesService } from './finance-categories.service';

@ApiTags('finance-categories')
@ApiBearerAuth()
@Controller('finance-categories')
export class FinanceCategoriesController {
  constructor(private readonly financeCategoriesService: FinanceCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista categorias financeiras do usuario' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.financeCategoriesService.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Cria categoria financeira' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFinanceCategoryDto,
  ) {
    return this.financeCategoriesService.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza categoria financeira' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceCategoryDto,
  ) {
    return this.financeCategoriesService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove categoria financeira' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.financeCategoriesService.remove(user.sub, id);
  }
}
