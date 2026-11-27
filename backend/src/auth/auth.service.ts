import { Injectable } from "@nestjs/common";
import { RequestWithContext } from "../common/interfaces/request-with-context.interface";
import { CredentialsService } from "./credentials/credentials.service";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { LoginDto } from "./dto/login.dto";
import { MfaCodeDto } from "./dto/mfa-code.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { RegisterDto } from "./dto/register.dto";
import { RequestEmailMfaBypassDto } from "./dto/request-email-mfa-bypass.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import { VerifyEmailMfaBypassDto } from "./dto/verify-email-mfa-bypass.dto";
import { VerifyLoginMfaDto } from "./dto/verify-login-mfa.dto";
import { EmailVerificationService } from "./link-challenge/email-verification.service";
import { PasswordRecoveryService } from "./link-challenge/password-recovery.service";
import { MfaEmailBypassService } from "./mfa/mfa-email-bypass.service";
import { MfaLoginService } from "./mfa/mfa-login.service";
import { MfaManagementService } from "./mfa/mfa-management.service";
import { SessionService } from "./session/session.service";

/** Porta de entrada da autenticacao: so encaminha para o servico de cada responsabilidade. */
@Injectable()
export class AuthService {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly sessions: SessionService,
    private readonly recovery: PasswordRecoveryService,
    private readonly emailVerification: EmailVerificationService,
    private readonly mfaLogin: MfaLoginService,
    private readonly mfaBypass: MfaEmailBypassService,
    private readonly mfaManagement: MfaManagementService,
  ) {}

  register(dto: RegisterDto, request?: RequestWithContext) {
    return this.credentials.register(dto, request);
  }

  login(dto: LoginDto, request?: RequestWithContext) {
    return this.credentials.login(dto, request);
  }

  me(userId: string) {
    return this.credentials.me(userId);
  }

  refresh(dto: RefreshDto, request?: RequestWithContext) {
    return this.sessions.refresh(dto, request);
  }

  logout(userId: string, sessionId: string) {
    return this.sessions.logout(userId, sessionId);
  }

  logoutAll(userId: string) {
    return this.sessions.logoutAll(userId);
  }

  forgotPassword(dto: ForgotPasswordDto, request?: RequestWithContext) {
    return this.recovery.forgotPassword(dto, request);
  }

  resetPassword(dto: ResetPasswordDto) {
    return this.recovery.resetPassword(dto);
  }

  verifyEmail(dto: VerifyEmailDto) {
    return this.emailVerification.verifyEmail(dto);
  }

  resendEmailVerification(userId: string, request?: RequestWithContext) {
    return this.emailVerification.resendEmailVerification(userId, request);
  }

  dispatchEmailVerification(userId: string, request?: RequestWithContext) {
    return this.emailVerification.dispatchEmailVerification(userId, request);
  }

  verifyLoginMfa(dto: VerifyLoginMfaDto, request?: RequestWithContext) {
    return this.mfaLogin.verifyLogin(dto, request);
  }

  requestEmailMfaBypass(dto: RequestEmailMfaBypassDto, request?: RequestWithContext) {
    return this.mfaBypass.request(dto, request);
  }

  verifyEmailMfaBypass(dto: VerifyEmailMfaBypassDto, request?: RequestWithContext) {
    return this.mfaBypass.verify(dto, request);
  }

  startMfaSetup(userId: string) {
    return this.mfaManagement.startSetup(userId);
  }

  confirmMfaSetup(userId: string, dto: MfaCodeDto) {
    return this.mfaManagement.confirmSetup(userId, dto);
  }

  regenerateMfaRecoveryCodes(userId: string, dto: MfaCodeDto) {
    return this.mfaManagement.regenerateRecoveryCodes(userId, dto);
  }

  disableMfa(userId: string, dto: MfaCodeDto) {
    return this.mfaManagement.disable(userId, dto);
  }
}
