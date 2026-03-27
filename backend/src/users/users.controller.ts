import { Body, Controller, Delete, Get, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  @ApiOperation({
    summary: "Retorna o perfil preferencial do usuario autenticado",
  })
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user.sub);
  }

  @Patch("me")
  @ApiOperation({ summary: "Atualiza preferencias do usuario autenticado" })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateUserDto) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Get("me/privacy-export")
  @ApiOperation({
    summary:
      "Exporta os dados pessoais do usuario autenticado em formato estruturado",
  })
  exportMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.exportMe(user.sub);
  }

  @Delete("me")
  @ApiOperation({
    summary: "Exclui a conta autenticada e os dados associados ao usuario",
  })
  deleteMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.deleteMe(user.sub);
  }
}
