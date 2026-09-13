import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateTagGroupDto } from './dto/create-tag-group.dto';
import { UpdateTagGroupDto } from './dto/update-tag-group.dto';
import { TagGroupsService } from './tag-groups.service';

@ApiTags('tag-groups')
@ApiBearerAuth()
@Controller('tag-groups')
export class TagGroupsController {
  constructor(private readonly tagGroupsService: TagGroupsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista grupos de tags do usuario' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tagGroupsService.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Cria grupo de tags' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTagGroupDto) {
    return this.tagGroupsService.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renomeia grupo de tags' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTagGroupDto,
  ) {
    return this.tagGroupsService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove grupo de tags' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.tagGroupsService.remove(user.sub, id);
  }
}
