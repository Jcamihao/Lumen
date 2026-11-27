import { ConfigService } from "@nestjs/config";
import { EntitlementsService } from "../billing/entitlements.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { GoalsService } from "../goals/goals.service";
import { PrismaService } from "../prisma/prisma.service";
import { RemindersService } from "../reminders/reminders.service";
import { TasksService } from "../tasks/tasks.service";
import { AssistantActionsService } from "./actions/assistant-actions.service";
import { AssistantService } from "./assistant.service";
import { AssistantHistoryService } from "./history/assistant-history.service";
import { SelahClient } from "./selah/selah.client";
import { SelahSettings } from "./selah/selah-settings";

const clients = new WeakMap<AssistantService, SelahClient>();

/** Monta o AssistantService com os servicos reais ligados, para testes que usam dependencias simuladas. */
export function buildAssistantService(
  dashboard: DashboardService,
  config: ConfigService,
  prisma: PrismaService,
  tasks: TasksService,
  goals: GoalsService,
  reminders: RemindersService,
  entitlements: EntitlementsService,
): AssistantService {
  const selah = new SelahClient(new SelahSettings(config));
  const service = new AssistantService(
    dashboard,
    prisma,
    entitlements,
    selah,
    new AssistantHistoryService(prisma, dashboard),
    new AssistantActionsService(tasks, goals, reminders),
  );
  clients.set(service, selah);
  return service;
}

/** O cliente do SelahIA usado pelo servico montado, para os testes simularem a rede. */
export const selahClientOf = (service: AssistantService): any => clients.get(service);
