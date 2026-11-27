import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { AuthService } from "./auth.service";
import { CredentialsService } from "./credentials/credentials.service";
import { EmailVerificationService } from "./link-challenge/email-verification.service";
import { LinkChallengeService } from "./link-challenge/link-challenge.service";
import { PasswordRecoveryService } from "./link-challenge/password-recovery.service";
import { MfaCodeVerifier } from "./mfa/mfa-code-verifier.service";
import { MfaGate } from "./mfa/mfa-gate";
import { MfaEmailBypassService } from "./mfa/mfa-email-bypass.service";
import { MfaLoginService } from "./mfa/mfa-login.service";
import { MfaManagementService } from "./mfa/mfa-management.service";
import { MfaService } from "./mfa.service";
import { SessionService } from "./session/session.service";
import { TokenIssuerService } from "./session/token-issuer.service";

/** Monta o AuthService com os servicos reais ligados, para testes que usam dependencias simuladas. */
export function buildAuthService(
  users: UsersService,
  jwt: JwtService,
  config: ConfigService,
  mail: MailService,
  prisma: PrismaService,
  mfa: MfaService,
): AuthService {
  const tokens = new TokenIssuerService(config, jwt, prisma, users);
  const links = new LinkChallengeService(config, prisma);
  const gate = new MfaGate(config);
  const verifier = new MfaCodeVerifier(prisma, mfa);
  const emailVerification = new EmailVerificationService(config, mail, users, links);
  const mfaLogin = new MfaLoginService(config, prisma, users, gate, verifier, tokens);
  return new AuthService(
    new CredentialsService(users, mail, tokens, gate, mfaLogin, emailVerification),
    new SessionService(config, jwt, prisma, users, tokens),
    new PasswordRecoveryService(config, mail, users, prisma, links),
    emailVerification,
    mfaLogin,
    new MfaEmailBypassService(prisma, users, mail, gate, tokens),
    new MfaManagementService(config, prisma, users, mfa, gate, verifier),
  );
}
