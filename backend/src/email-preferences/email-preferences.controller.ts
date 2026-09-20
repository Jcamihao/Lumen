import { Body, Controller, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { EmailPreferencesService } from "./email-preferences.service";

@ApiTags("email-preferences")
@Controller("email-preferences")
export class EmailPreferencesController {
  constructor(private readonly service: EmailPreferencesService) {}

  /**
   * Aceita o token no body (pagina do frontend) ou na query (one-click do
   * cliente de email, RFC 8058, que faz POST direto na URL do
   * List-Unsubscribe com um corpo form-urlencoded).
   */
  @Public()
  @Post("unsubscribe")
  @ApiOperation({ summary: "Deixa de receber uma categoria de email." })
  unsubscribe(
    @Query("token") queryToken?: string,
    // Sem DTO de proposito: o one-click do Gmail manda
    // `List-Unsubscribe=One-Click` no corpo e o ValidationPipe global
    // (forbidNonWhitelisted) rejeitaria essa chave desconhecida.
    @Body() body?: Record<string, unknown>,
  ) {
    const bodyToken = typeof body?.token === "string" ? body.token : undefined;
    return this.service.unsubscribe(bodyToken ?? queryToken);
  }
}
