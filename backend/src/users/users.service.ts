import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TransactionType, UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import {
  CURRENT_AI_CONSENT_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
} from "./privacy.constants";

type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  preferredCurrency?: string;
  monthlyIncome?: number;
  monthClosingDay?: number;
  timezone?: string;
  role?: UserRole;
  privacyNoticeAccepted?: boolean;
  aiAssistantEnabled?: boolean;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(input: CreateUserInput) {
    const now = new Date();
    const privacyAccepted = Boolean(input.privacyNoticeAccepted);
    const aiEnabled = Boolean(input.aiAssistantEnabled && privacyAccepted);

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        role: input.role ?? UserRole.USER,
        preferredCurrency: input.preferredCurrency ?? "BRL",
        monthlyIncome:
          input.monthlyIncome !== undefined
            ? new Prisma.Decimal(input.monthlyIncome)
            : new Prisma.Decimal(0),
        monthClosingDay: input.monthClosingDay ?? 30,
        timezone: input.timezone ?? "America/Sao_Paulo",
        privacyNoticeAcceptedAt: privacyAccepted ? now : null,
        privacyNoticeVersion: privacyAccepted
          ? CURRENT_PRIVACY_NOTICE_VERSION
          : null,
        aiAssistantEnabled: aiEnabled,
        aiAssistantConsentAt: aiEnabled ? now : null,
        aiAssistantConsentVersion: aiEnabled
          ? CURRENT_AI_CONSENT_VERSION
          : null,
      },
    });

    await Promise.all([
      this.prisma.taskCategory.createMany({
        data: [
          {
            userId: user.id,
            name: "Pessoal",
            color: "#7c5cff",
            icon: "self_improvement",
          },
          { userId: user.id, name: "Trabalho", color: "#0f9d7a", icon: "work" },
          { userId: user.id, name: "Casa", color: "#f18f01", icon: "home" },
        ],
      }),
      this.prisma.financeCategory.createMany({
        data: [
          {
            userId: user.id,
            name: "Moradia",
            color: "#f97316",
            icon: "home",
            type: TransactionType.EXPENSE,
          },
          {
            userId: user.id,
            name: "Alimentacao",
            color: "#ef4444",
            icon: "restaurant",
            type: TransactionType.EXPENSE,
          },
          {
            userId: user.id,
            name: "Salario",
            color: "#10b981",
            icon: "payments",
            type: TransactionType.INCOME,
          },
        ],
      }),
    ]);

    return this.findById(user.id);
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        taskCategories: true,
        financeCategories: true,
      },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        taskCategories: {
          orderBy: { name: "asc" },
        },
        financeCategories: {
          orderBy: { name: "asc" },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("Usuario nao encontrado.");
    }

    return user;
  }

  async getMe(userId: string) {
    const user = await this.findById(userId);
    return this.sanitizeUser(user);
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        privacyNoticeAcceptedAt: true,
        aiAssistantConsentAt: true,
      },
    });

    if (!currentUser) {
      throw new NotFoundException("Usuario nao encontrado.");
    }

    if (
      dto.aiAssistantEnabled &&
      !currentUser.privacyNoticeAcceptedAt &&
      !dto.privacyNoticeAccepted
    ) {
      throw new BadRequestException(
        "Aceite o aviso de privacidade antes de ativar o assistente com IA externa.",
      );
    }

    const now = new Date();

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        preferredCurrency: dto.preferredCurrency,
        monthlyIncome:
          dto.monthlyIncome !== undefined
            ? new Prisma.Decimal(dto.monthlyIncome)
            : undefined,
        monthClosingDay: dto.monthClosingDay,
        timezone: dto.timezone,
        ...(dto.privacyNoticeAccepted
          ? {
              privacyNoticeAcceptedAt:
                currentUser.privacyNoticeAcceptedAt ?? now,
              privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION,
            }
          : {}),
        ...(dto.aiAssistantEnabled === undefined
          ? {}
          : dto.aiAssistantEnabled
            ? {
                aiAssistantEnabled: true,
                aiAssistantConsentAt: currentUser.aiAssistantConsentAt ?? now,
                aiAssistantConsentVersion: CURRENT_AI_CONSENT_VERSION,
              }
            : {
                aiAssistantEnabled: false,
                aiAssistantConsentAt: null,
                aiAssistantConsentVersion: null,
              }),
      },
    });

    return this.getMe(userId);
  }

  async updateRefreshToken(userId: string, refreshTokenHash: string | null) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });
  }

  async updateLastLogin(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  async exportMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        taskCategories: {
          orderBy: { name: "asc" },
        },
        financeCategories: {
          orderBy: [{ type: "asc" }, { name: "asc" }],
        },
        tasks: {
          include: {
            category: true,
            goal: true,
            subtasks: {
              orderBy: { sortOrder: "asc" },
            },
          },
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        },
        transactions: {
          include: {
            category: true,
            task: {
              select: {
                id: true,
                title: true,
              },
            },
            goal: {
              select: {
                id: true,
                title: true,
              },
            },
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        },
        goals: {
          orderBy: [{ status: "asc" }, { targetDate: "asc" }],
        },
        reminders: {
          orderBy: { remindAt: "asc" },
        },
        insights: {
          orderBy: { createdAt: "desc" },
        },
        forecasts: {
          orderBy: { referenceDate: "desc" },
        },
        importJobs: {
          orderBy: { createdAt: "desc" },
        },
        notifications: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("Usuario nao encontrado.");
    }

    const { passwordHash, refreshTokenHash, ...safeUser } = user;
    const aiProcessingActive = Boolean(
      safeUser.aiAssistantEnabled &&
      safeUser.aiAssistantConsentAt &&
      safeUser.privacyNoticeAcceptedAt,
    );

    return {
      exportedAt: new Date().toISOString(),
      controller: {
        company: "codeStage Solucoes",
        product: "LUMEN",
      },
      privacy: {
        privacyNoticeVersionCurrent: CURRENT_PRIVACY_NOTICE_VERSION,
        aiConsentVersionCurrent: CURRENT_AI_CONSENT_VERSION,
        privacyNoticeAcceptedAt: safeUser.privacyNoticeAcceptedAt,
        privacyNoticeVersion: safeUser.privacyNoticeVersion,
        aiAssistantEnabled: safeUser.aiAssistantEnabled,
        aiAssistantConsentAt: safeUser.aiAssistantConsentAt,
        aiAssistantConsentVersion: safeUser.aiAssistantConsentVersion,
        externalProcessing: {
          active: aiProcessingActive,
          processor: aiProcessingActive ? "SelahIA" : null,
          purpose: aiProcessingActive
            ? "Responder perguntas do assistente de vida com contexto minimizado."
            : "Nenhum provedor externo de IA habilitado neste momento.",
          sharedDataCategories: aiProcessingActive
            ? [
                "primeiro nome",
                "pergunta do usuario com redacao de padroes sensiveis",
                "resumo de tarefas relevantes",
                "resumo de transacoes recentes",
                "resumo de metas, lembretes, insights e previsao",
              ]
            : [],
        },
      },
      rights: [
        "confirmacao e acesso aos dados",
        "correcao de dados pessoais",
        "revogacao do consentimento para IA externa",
        "portabilidade via exportacao estruturada",
        "eliminacao da conta e dos dados associados, salvo obrigacoes legais",
      ],
      profile: {
        ...safeUser,
        monthlyIncome: Number(safeUser.monthlyIncome ?? 0),
      },
      datasets: {
        taskCategories: safeUser.taskCategories,
        financeCategories: safeUser.financeCategories,
        tasks: safeUser.tasks.map((task) => ({
          ...task,
          estimatedAmount:
            task.estimatedAmount !== null && task.estimatedAmount !== undefined
              ? Number(task.estimatedAmount)
              : null,
        })),
        transactions: safeUser.transactions.map((transaction) => ({
          ...transaction,
          amount: Number(transaction.amount),
        })),
        goals: safeUser.goals.map((goal) => ({
          ...goal,
          targetAmount: Number(goal.targetAmount),
          currentAmount: Number(goal.currentAmount),
        })),
        reminders: safeUser.reminders,
        insights: safeUser.insights,
        forecasts: safeUser.forecasts.map((forecast) => ({
          ...forecast,
          predictedBalance: Number(forecast.predictedBalance),
        })),
        importJobs: safeUser.importJobs,
        notifications: safeUser.notifications,
      },
    };
  }

  async deleteMe(userId: string) {
    await this.prisma.user.delete({
      where: { id: userId },
    });

    return {
      message: "Conta e dados pessoais excluidos com sucesso.",
      deletedAt: new Date().toISOString(),
    };
  }

  async sanitizeUser(user: Awaited<ReturnType<UsersService["findById"]>>) {
    const { passwordHash, refreshTokenHash, ...safeUser } = user;
    return {
      ...safeUser,
      monthlyIncome: Number(safeUser.monthlyIncome ?? 0),
    };
  }
}
