/**
 * Envia o email de confirmacao para as contas que ja existiam antes do fluxo
 * de confirmacao. Rotina de operacao: roda no servidor, nao e uma rota.
 *
 *   node dist/scripts/send-verification-emails.js                 # ensaio (nao envia)
 *   node dist/scripts/send-verification-emails.js --email=voce@x  # testar em UMA caixa
 *   node dist/scripts/send-verification-emails.js --send          # envia para todos
 *
 * Opcoes: --limit=N  --delay-ms=N (padrao 700)  --force  --allow-localhost
 */
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { resolve } from "path";
import { AuthModule } from "../auth/auth.module";
import { EmailVerificationBackfillService } from "../auth/email-verification-backfill.service";
import { appConfig } from "../config/app.config";
import { authConfig } from "../config/auth.config";
import { mailConfig } from "../config/mail.config";
import { PrismaModule } from "../prisma/prisma.module";

// Contexto minimo de proposito: sem AppModule nao sobem as filas nem os workers,
// que duplicariam o processamento do backend que ja esta rodando.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(__dirname, "../../../.env")],
      load: [appConfig, authConfig, mailConfig],
    }),
    PrismaModule,
    AuthModule,
  ],
})
class VerificationBackfillModule {}

function readFlag(args: string[], name: string) {
  return args.includes(`--${name}`);
}

function readValue(args: string[], name: string) {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(readValue(args, "limit"));
  const delayMs = Number(readValue(args, "delay-ms") ?? 700);

  const app = await NestFactory.createApplicationContext(
    VerificationBackfillModule,
    { logger: ["error", "warn"] },
  );

  try {
    const report = await app
      .get(EmailVerificationBackfillService)
      .run({
        send: readFlag(args, "send"),
        email: readValue(args, "email"),
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
        delayMs: Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 700,
        force: readFlag(args, "force"),
        allowLocalhost: readFlag(args, "allow-localhost"),
      });

    report.lines.forEach((line) => console.log(line));
    console.log(
      `\n${report.dryRun ? "ENSAIO (nada foi enviado)" : "ENVIO"}: ` +
        `${report.candidates} conta(s) sem confirmacao, ` +
        `${report.skippedAlreadyHasLink} ja com link valido, ` +
        `${report.sent} enviado(s), ${report.failed} falha(s).`,
    );
    if (report.dryRun) {
      console.log("Para enviar de verdade, rode de novo com --send.");
    }
    process.exitCode = report.failed > 0 ? 2 : 0;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(`Erro: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
