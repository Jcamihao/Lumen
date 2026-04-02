import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ApplyAssistantActionDto } from './dto/apply-assistant-action.dto';
import { AskAssistantDto } from './dto/ask-assistant.dto';
import { AssistantService } from './assistant.service';

@ApiTags('assistant')
@ApiBearerAuth()
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('ask')
  @ApiOperation({ summary: 'Assistente de vida com respostas orientadas pelo estado atual do usuario' })
  ask(@CurrentUser() user: AuthenticatedUser, @Body() dto: AskAssistantDto) {
    return this.assistantService.ask(user.sub, dto.question, {
      history: dto.history,
      originModule: dto.originModule,
    });
  }

  @Get('pulse')
  @ApiOperation({ summary: 'Pulso proativo do Selah para o dashboard e modulos do app' })
  pulse(@CurrentUser() user: AuthenticatedUser) {
    return this.assistantService.getPulse(user.sub);
  }

  @Post('actions')
  @ApiOperation({ summary: 'Executa uma acao sugerida pelo Selah dentro do LUMEN' })
  applyAction(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApplyAssistantActionDto,
  ) {
    return this.assistantService.applyAction(user.sub, dto);
  }
}
