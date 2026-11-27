import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { RequestWithContext } from '../common/interfaces/request-with-context.interface';
import { AuthService } from './auth.service';
import { MfaCodeDto } from './dto/mfa-code.dto';
import { RequestEmailMfaBypassDto } from './dto/request-email-mfa-bypass.dto';
import { VerifyEmailMfaBypassDto } from './dto/verify-email-mfa-bypass.dto';
import { VerifyLoginMfaDto } from './dto/verify-login-mfa.dto';
import { RefreshCookieService } from './session/refresh-cookie.service';

@ApiTags('auth')
@Controller('auth')
export class AuthMfaController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  @Public()
  @Post('mfa/verify-login')
  @ApiOperation({ summary: 'Confirma o desafio MFA do login e emite os tokens da sessao' })
  async verifyLoginMfa(
    @Body() dto: VerifyLoginMfaDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authResponse = await this.authService.verifyLoginMfa(dto, request);
    return this.refreshCookie.attach(authResponse, request, response);
  }

  @Public()
  @Post('mfa/email-bypass/request')
  @ApiOperation({ summary: 'Solicita codigo de recuperacao MFA por email' })
  requestEmailMfaBypass(
    @Body() dto: RequestEmailMfaBypassDto,
    @Req() request: RequestWithContext,
  ) {
    return this.authService.requestEmailMfaBypass(dto, request);
  }

  @Public()
  @Post('mfa/email-bypass/verify')
  @ApiOperation({ summary: 'Verifica o codigo de recuperacao MFA enviado por email' })
  async verifyEmailMfaBypass(
    @Body() dto: VerifyEmailMfaBypassDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authResponse = await this.authService.verifyEmailMfaBypass(dto, request);
    return this.refreshCookie.attach(authResponse, request, response);
  }

  @Post('mfa/setup')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inicia a configuracao do MFA com TOTP' })
  startMfaSetup(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.startMfaSetup(user.sub);
  }

  @Post('mfa/confirm-setup')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirma a ativacao do MFA com o primeiro codigo TOTP' })
  confirmMfaSetup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaCodeDto,
  ) {
    return this.authService.confirmMfaSetup(user.sub, dto);
  }

  @Post('mfa/recovery-codes/regenerate')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Gera novos codigos de recuperacao para o MFA' })
  regenerateRecoveryCodes(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaCodeDto,
  ) {
    return this.authService.regenerateMfaRecoveryCodes(user.sub, dto);
  }

  @Post('mfa/disable')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desativa o MFA da conta autenticada' })
  disableMfa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaCodeDto,
  ) {
    return this.authService.disableMfa(user.sub, dto);
  }
}
