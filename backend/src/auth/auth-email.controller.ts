import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { RequestWithContext } from '../common/interfaces/request-with-context.interface';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthEmailController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('forgot-password')
  @ApiOperation({ summary: 'Envia por email um link para redefinir a senha' })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: RequestWithContext,
  ) {
    return this.authService.forgotPassword(dto, request);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Define uma nova senha a partir do link enviado por email' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Post('verify-email')
  @ApiOperation({ summary: 'Confirma o email a partir do link enviado' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('resend-verification')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reenvia o email de confirmacao para o usuario logado' })
  resendVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithContext,
  ) {
    return this.authService.resendEmailVerification(user.sub, request);
  }
}
