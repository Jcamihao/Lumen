import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { RequestWithContext } from '../common/interfaces/request-with-context.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { MfaCodeDto } from './dto/mfa-code.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyLoginMfaDto } from './dto/verify-login-mfa.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Cria uma nova conta de usuario no LUMEN' })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authResponse = await this.authService.register(dto, request);
    return this.finalizeAuthResponse(authResponse, request, response);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Autentica o usuario e retorna access/refresh token' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authResponse = await this.authService.login(dto, request);
    return this.finalizeAuthResponse(authResponse, request, response);
  }

  @Public()
  @Post('mfa/verify-login')
  @ApiOperation({ summary: 'Confirma o desafio MFA do login e emite os tokens da sessao' })
  async verifyLoginMfa(
    @Body() dto: VerifyLoginMfaDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authResponse = await this.authService.verifyLoginMfa(dto, request);
    return this.finalizeAuthResponse(authResponse, request, response);
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

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Renova os tokens JWT com refresh token valido' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const authResponse = await this.authService.refresh(dto, request);
      return this.finalizeAuthResponse(authResponse, request, response);
    } catch (error) {
      if (this.shouldUseRefreshCookie(request)) {
        this.clearRefreshCookie(response);
      }

      throw error;
    }
  }

  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoga a sessao autenticada atual' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.clearRefreshCookie(response);
    return this.authService.logout(user.sub, user.sessionId);
  }

  @Post('logout-all')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoga todas as sessoes autenticadas do usuario' })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.clearRefreshCookie(response);
    return this.authService.logoutAll(user.sub);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retorna os dados do usuario autenticado' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.sub);
  }

  private finalizeAuthResponse(
    authResponse:
      | {
          accessToken: string;
          refreshToken: string;
          user: unknown;
        }
      | {
          requiresMfa: true;
          challengeId: string;
          challengeExpiresAt: string;
          availableMethods: Array<'totp' | 'recovery_code'>;
        },
    request: RequestWithContext,
    response: Response,
  ) {
    if (!('accessToken' in authResponse)) {
      return authResponse;
    }

    if (!this.shouldUseRefreshCookie(request)) {
      return authResponse;
    }

    response.cookie(
      this.configService.getOrThrow<string>('auth.refreshCookieName'),
      authResponse.refreshToken,
      {
        httpOnly: true,
        secure:
          this.configService.get<boolean>('auth.refreshCookieSecure') ?? false,
        sameSite:
          (this.configService.get<'lax' | 'strict' | 'none'>(
            'auth.refreshCookieSameSite',
          ) ?? 'lax'),
        domain: this.configService.get<string>('auth.refreshCookieDomain'),
        path:
          this.configService.get<string>('auth.refreshCookiePath') ??
          '/api/v1/auth',
        maxAge: this.parseDurationToMs(
          this.configService.get<string>('auth.refreshExpiresIn') ?? '7d',
        ),
      },
    );

    return {
      accessToken: authResponse.accessToken,
      user: authResponse.user,
    };
  }

  private clearRefreshCookie(response: Response) {
    response.clearCookie(
      this.configService.getOrThrow<string>('auth.refreshCookieName'),
      {
        httpOnly: true,
        secure:
          this.configService.get<boolean>('auth.refreshCookieSecure') ?? false,
        sameSite:
          (this.configService.get<'lax' | 'strict' | 'none'>(
            'auth.refreshCookieSameSite',
          ) ?? 'lax'),
        domain: this.configService.get<string>('auth.refreshCookieDomain'),
        path:
          this.configService.get<string>('auth.refreshCookiePath') ??
          '/api/v1/auth',
      },
    );
  }

  private shouldUseRefreshCookie(request: RequestWithContext) {
    const clientPlatform = request.header('x-lumen-client-platform');
    return clientPlatform?.trim().toLowerCase() === 'web';
  }

  private parseDurationToMs(value: string) {
    const normalizedValue = value.trim().toLowerCase();
    const match = normalizedValue.match(/^(\d+)(ms|s|m|h|d)$/);

    if (!match) {
      return 7 * 24 * 60 * 60 * 1_000;
    }

    const amount = Number(match[1]);
    const unit = match[2];

    switch (unit) {
      case 'ms':
        return amount;
      case 's':
        return amount * 1_000;
      case 'm':
        return amount * 60_000;
      case 'h':
        return amount * 3_600_000;
      case 'd':
        return amount * 86_400_000;
      default:
        return 7 * 24 * 60 * 60 * 1_000;
    }
  }
}
