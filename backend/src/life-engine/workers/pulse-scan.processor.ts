import { ConfigService } from "@nestjs/config";
import { InstallmentMaterializerService } from "../../installments/installment-materializer.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RecurringMaterializerService } from "../../recurring-transactions/recurring-materializer.service";
import { LifeEngineService } from "../life-engine.service";
import { getErrorMessage } from "./error-message";
import { localHourFor } from "./local-time";
import { PulseUserOutcome, PulseUserProcessor } from "./pulse-user.processor";
import { workerLogger } from "./worker-logger";

const DEFAULT_PULSE_HOUR_LOCAL = 7;

type PulseStats = {
  touched: number;
  digests: number;
  billReminders: number;
  autoContributions: number;
  forecastsResolved: number;
};

function emptyStats(): PulseStats {
  return { touched: 0, digests: 0, billReminders: 0, autoContributions: 0, forecastsResolved: 0 };
}

/**
 * Roda a cada tick do PULSE_SCAN_QUEUE (de hora em hora). Recalcula
 * insights so de quem esta, agora, na hora local configurada — reusa o
 * mesmo touchUserData() que ja dispara reativamente apos uma mutacao, so
 * que aqui o gatilho e o relogio, nao uma acao do usuario.
 */
export class PulseScanProcessor {
  private readonly logger = workerLogger();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly recurringMaterializer: RecurringMaterializerService,
    private readonly installmentMaterializer: InstallmentMaterializerService,
    private readonly pulseUser: PulseUserProcessor,
  ) {}

  async run() {
    const targetHour = this.configService.get<number>("app.selahPulseHourLocal", DEFAULT_PULSE_HOUR_LOCAL);
    const users = await this.findUsers();
    const stats = emptyStats();

    for (const user of users) {
      await this.materializeDueItems(user.id);
      if (localHourFor(user.timezone) !== targetHour) continue;

      this.record(stats, await this.pulseUser.process(user));
    }

    this.logSummary(stats, targetHour);
  }

  private findUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        timezone: true,
        lastWeeklyDigestAt: true,
        preferredCurrency: true,
        emailVerifiedAt: true,
        emailBillReminders: true,
      },
    });
  }

  private logSummary(stats: PulseStats, targetHour: number) {
    if (stats.touched === 0) return;

    this.logger.log(
      `pulse_scan touched=${stats.touched} digests=${stats.digests} billReminders=${stats.billReminders} autoContributions=${stats.autoContributions} forecastsResolved=${stats.forecastsResolved} targetHour=${targetHour}`,
    );
  }

  // Contas fixas e parcelas vencem no dia local de cada um, nao so na hora
  // do pulso: gera o lancamento na virada do dia mesmo que ninguem abra o app.
  private async materializeDueItems(userId: string) {
    await this.materializeAndTouch("recurring_materialize", userId, () =>
      this.recurringMaterializer.materializeDue(userId),
    );
    await this.materializeAndTouch("installments_materialize", userId, () =>
      this.installmentMaterializer.materializeDue(userId),
    );
  }

  private async materializeAndTouch(
    label: string,
    userId: string,
    materialize: () => Promise<number>,
  ) {
    try {
      if ((await materialize()) > 0) {
        await this.lifeEngineService.touchUserData(userId);
      }
    } catch (error) {
      this.logger.warn(`${label}_failed userId=${userId} reason=${getErrorMessage(error)}`);
    }
  }

  private record(stats: PulseStats, outcome: PulseUserOutcome) {
    stats.touched += 1;
    stats.autoContributions += outcome.autoContributions;
    stats.forecastsResolved += outcome.forecastsResolved;
    if (outcome.billReminder) stats.billReminders += 1;
    if (outcome.digest) stats.digests += 1;
  }
}
