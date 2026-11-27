import { BillReminderService } from "../bill-reminder.service";
import { ForecastsService } from "../../forecasts/forecasts.service";
import { LifeEngineService } from "../life-engine.service";
import { daysSince, isMondayLocal } from "./local-time";
import { getErrorMessage } from "./error-message";
import { GoalRecurringContributions } from "./goal-recurring-contributions";
import { WeeklyDigest } from "./weekly-digest";
import { workerLogger } from "./worker-logger";

const WEEKLY_DIGEST_MIN_INTERVAL_DAYS = 6;

export type PulseUser = {
  id: string;
  email: string;
  name: string;
  timezone: string;
  lastWeeklyDigestAt: Date | null;
  preferredCurrency: string;
  emailVerifiedAt: Date | null;
  emailBillReminders: boolean;
};

export type PulseUserOutcome = {
  autoContributions: number;
  forecastsResolved: number;
  billReminder: boolean;
  digest: boolean;
};

export class PulseUserProcessor {
  private readonly logger = workerLogger();

  constructor(
    private readonly goalContributions: GoalRecurringContributions,
    private readonly lifeEngineService: LifeEngineService,
    private readonly forecastsService: ForecastsService,
    private readonly billReminderService: BillReminderService,
    private readonly weeklyDigest: WeeklyDigest,
  ) {}

  async process(user: PulseUser): Promise<PulseUserOutcome> {
    const autoContributions = await this.goalContributions.contributeDue(
      user.id,
      user.timezone,
      user.preferredCurrency,
    );

    await this.lifeEngineService.touchUserData(user.id);

    const forecastsResolved = await this.forecastsService.resolveMatureSnapshots(user.id);
    const billReminder = await this.sendBillReminders(user);
    const digest = await this.sendDigestIfDue(user);

    return { autoContributions, forecastsResolved, billReminder, digest };
  }

  private async sendBillReminders(user: PulseUser): Promise<boolean> {
    try {
      return await this.billReminderService.sendDueReminders(user);
    } catch (error) {
      this.logger.warn(`bill_due_reminder_failed userId=${user.id} reason=${getErrorMessage(error)}`);
      return false;
    }
  }

  private async sendDigestIfDue(user: PulseUser): Promise<boolean> {
    const due =
      isMondayLocal(user.timezone) &&
      daysSince(user.lastWeeklyDigestAt) >= WEEKLY_DIGEST_MIN_INTERVAL_DAYS;

    return due ? this.weeklyDigest.send(user.id) : false;
  }
}
