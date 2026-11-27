import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { RequestWithContext } from '../common/interfaces/request-with-context.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshCookieService } from './session/refresh-cookie.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshCookie: RefreshCookieService,
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
    return this.refreshCookie.attach(authResponse, request, response);
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
    return this.refreshCookie.attach(authResponse, request, response);
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
      return this.refreshCookie.attach(authResponse, request, response);
    } catch (error) {
      if (this.refreshCookie.shouldUse(request)) {
        this.refreshCookie.clear(response);
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
    this.refreshCookie.clear(response);
    return this.authService.logout(user.sub, user.sessionId);
  }

  @Post('logout-all')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoga todas as sessoes autenticadas do usuario' })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.refreshCookie.clear(response);
    return this.authService.logoutAll(user.sub);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retorna os dados do usuario autenticado' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.sub);
  }
}
