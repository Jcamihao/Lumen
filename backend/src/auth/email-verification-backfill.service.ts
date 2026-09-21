import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthChallengeType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";

export type EmailVerificationBackfillOptions = {
  /** Sem isso e ensaio: lista quem receberia, nao envia nem grava nada. */
  send: boolean;
  /** Restringe a um unico email (bom para testar na propria caixa primeiro). */
  email?: string;
  limit?: number;
  /** Pausa entre envios, para respeitar o limite de requisicoes do provedor. */
  delayMs: number;
  /** Reenvia tambem para quem ja tem um link valido na caixa (invalida o antigo). */
  force: boolean;
  /** Permite links apontando para localhost (so faz sentido em teste local). */
  allowLocalhost: boolean;
};

export type EmailVerificationBackfillReport = {
  dryRun: boolean;
  candidates: number;
  skippedAlreadyHasLink: number;
  sent: number;
  failed: number;
  lines: string[];
};

export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

/**
 * Manda o email de confirmacao para contas que ja existiam antes do fluxo de
 * confirmacao (emailVerifiedAt nulo). Roda por linha de comando, nao por rota:
 * nao ha endpoint que dispare email em massa.
 *
 * Seguro para repetir: quem ja recebeu um link ainda valido e pulado, e se um
 * envio falha o link recem-criado e removido para a proxima rodada tentar de
 * novo.
 */
@Injectable()
export class EmailVerificationBackfillService {
  private readonly logger = new Logger(EmailVerificationBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {}

  async run(
    options: EmailVerificationBackfillOptions,
  ): Promise<EmailVerificationBackfillReport> {
    if (options.send) {
      this.assertSafeToSend(options);
    }

    const users = await this.prisma.user.findMany({
      where: {
        emailVerifiedAt: null,
        ...(options.email
          ? { email: options.email.trim().toLowerCase() }
          : {}),
      },
      select: { id: true, email: true },
      orderBy: { createdAt: "asc" },
      ...(options.limit ? { take: options.limit } : {}),
    });

    const withValidLink = options.force
      ? new Set<string>()
      : await this.usersWithValidLink(users.map((user) => user.id));

    const report: EmailVerificationBackfillReport = {
      dryRun: !options.send,
      candidates: users.length,
      skippedAlreadyHasLink: 0,
      sent: 0,
      failed: 0,
      lines: [],
    };

    for (const user of users) {
      const label = maskEmail(user.email);

      if (withValidLink.has(user.id)) {
        report.skippedAlreadyHasLink += 1;
        report.lines.push(`pulado (ja tem link valido): ${label}`);
        continue;
      }

      if (!options.send) {
        report.lines.push(`enviaria: ${label}`);
        continue;
      }

      try {
        const result = await this.authService.dispatchEmailVerification(user.id);

        if (result.alreadyVerified) {
          report.lines.push(`pulado (ja confirmado): ${label}`);
        } else if (result.skipped) {
          throw new Error("provedor de email desligado ou incompleto");
        } else {
          report.sent += 1;
          report.lines.push(`enviado: ${label}`);
        }
      } catch (error) {
        report.failed += 1;
        report.lines.push(`FALHOU: ${label}`);
        this.logger.warn(
          `verification_backfill_failed userId=${user.id} reason=${
            error instanceof Error ? error.message : "erro desconhecido"
          }`,
        );
        // Sem email entregue nao deve sobrar um link "valido" que faria a
        // proxima rodada pular esta pessoa.
        await this.prisma.authChallenge.deleteMany({
          where: {
            userId: user.id,
            type: AuthChallengeType.EMAIL_VERIFICATION,
            completedAt: null,
          },
        });
      }

      if (options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
    }

    return report;
  }

  private assertSafeToSend(options: EmailVerificationBackfillOptions) {
    if (!this.configService.get<boolean>("mail.enabled")) {
      throw new Error(
        "RESEND_ENABLED esta desligado: nada seria enviado. Ligue o Resend antes de rodar com --send.",
      );
    }

    const frontendUrl = this.configService.get<string>("app.frontendUrl") ?? "";
    if (/localhost|127\.0\.0\.1/.test(frontendUrl) && !options.allowLocalhost) {
      throw new Error(
        `FRONTEND_URL aponta para ${frontendUrl}: os links do email ficariam quebrados para o usuario. Defina FRONTEND_URL com o dominio publico.`,
      );
    }
  }

  private async usersWithValidLink(userIds: string[]) {
    if (userIds.length === 0) {
      return new Set<string>();
    }

    const pending = await this.prisma.authChallenge.findMany({
      where: {
        userId: { in: userIds },
        type: AuthChallengeType.EMAIL_VERIFICATION,
        completedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { userId: true },
    });

    return new Set(pending.map((challenge) => challenge.userId));
  }
}
