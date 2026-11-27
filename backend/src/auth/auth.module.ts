import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { MailModule } from "../mail/mail.module";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { CredentialsService } from "./credentials/credentials.service";
import { EmailVerificationBackfillService } from "./email-verification-backfill.service";
import { EmailVerificationService } from "./link-challenge/email-verification.service";
import { LinkChallengeService } from "./link-challenge/link-challenge.service";
import { PasswordRecoveryService } from "./link-challenge/password-recovery.service";
import { MfaCodeVerifier } from "./mfa/mfa-code-verifier.service";
import { MfaGate } from "./mfa/mfa-gate";
import { MfaEmailBypassService } from "./mfa/mfa-email-bypass.service";
import { MfaLoginService } from "./mfa/mfa-login.service";
import { MfaManagementService } from "./mfa/mfa-management.service";
import { SessionService } from "./session/session.service";
import { TokenIssuerService } from "./session/token-issuer.service";
import { MfaService } from "./mfa.service";
import { JwtStrategy } from "./strategies/jwt.strategy";

@Module({
  imports: [UsersModule, MailModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    CredentialsService,
    SessionService,
    TokenIssuerService,
    LinkChallengeService,
    PasswordRecoveryService,
    EmailVerificationService,
    MfaGate,
    MfaCodeVerifier,
    MfaLoginService,
    MfaEmailBypassService,
    MfaManagementService,
    EmailVerificationBackfillService,
    MfaService,
    JwtStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
