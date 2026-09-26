import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TransactionType, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { toCategoryResponse } from "../finance-categories/finance-categories.service";
import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_TAG_GROUPS } from "../tag-groups/tag-groups.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import {
  CURRENT_AI_CONSENT_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
} from "./privacy.constants";

type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  avatarUrl?: string;
  phone?: string;
  birthDate?: string;
  occupation?: string;
  primaryGoal?: string;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async createUser(input: CreateUserInput) {
    const now = new Date();
    const privacyAccepted = Boolean(input.privacyNoticeAccepted);
    const aiEnabled = Boolean(input.aiAssistantEnabled && privacyAccepted);

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        avatarUrl: input.avatarUrl,
        phone: input.phone,
        birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
        occupation: input.occupation,
        primaryGoal: input.primaryGoal,
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
      this.prisma.tagGroup.createMany({
        data: DEFAULT_TAG_GROUPS.map((group, index) => ({
          userId: user.id,
          name: group.name,
          color: group.color,
          isDefault: true,
          sortOrder: index,
        })),
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
        tagGroups: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
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
        tagGroups: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
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
        avatarUrl: dto.avatarUrl,
        phone: dto.phone,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        occupation: dto.occupation,
        primaryGoal: dto.primaryGoal,
        preferredCurrency: dto.preferredCurrency,
        monthlyIncome:
          dto.monthlyIncome !== undefined
            ? new Prisma.Decimal(dto.monthlyIncome)
            : undefined,
        monthClosingDay: dto.monthClosingDay,
        timezone: dto.timezone,
        emailWeeklyDigest: dto.emailWeeklyDigest,
        emailReminders: dto.emailReminders,
        emailInsightAlerts: dto.emailInsightAlerts,
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

  async updatePassword(userId: string, passwordHash: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async markEmailVerified(userId: string) {
    await this.prisma.user.updateMany({
      where: { id: userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
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
        tagGroups: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
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
        receiptScans: {
          include: {
            items: {
              orderBy: { sortOrder: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        notifications: {
          orderBy: { createdAt: "desc" },
        },
        forecastSnapshots: {
          orderBy: { targetDate: "desc" },
        },
        recurringTransactions: {
          orderBy: { createdAt: "desc" },
        },
        assistantTurns: {
          orderBy: { createdAt: "desc" },
        },
        supportRequests: {
          orderBy: { createdAt: "desc" },
        },
        // So metadados do dispositivo; o hash do refresh token nunca sai daqui.
        authSessions: {
          select: {
            id: true,
            userAgent: true,
            ipAddress: true,
            lastUsedAt: true,
            expiresAt: true,
            revokedAt: true,
            revokeReason: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("Usuario nao encontrado.");
    }

    // As listas vao em `datasets`; o `profile` fica so com os dados da conta.
    const {
      passwordHash,
      mfaTotpSecretEncrypted,
      mfaPendingTotpSecretEncrypted,
      mfaRecoveryCodes,
      taskCategories,
      financeCategories,
      tagGroups,
      tasks,
      transactions,
      goals,
      reminders,
      insights,
      forecasts,
      forecastSnapshots,
      recurringTransactions,
      importJobs,
      receiptScans,
      notifications,
      assistantTurns,
      supportRequests,
      authSessions,
      ...safeUser
    } = user;
    const aiProcessingActive = Boolean(
      safeUser.aiAssistantEnabled &&
      safeUser.aiAssistantConsentAt &&
      safeUser.privacyNoticeAcceptedAt,
    );
    const mfaFeatureEnabled = this.isMfaFeatureEnabled();

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
        mfaEnabledAt: mfaFeatureEnabled ? safeUser.mfaEnabledAt : null,
        mfaLastVerifiedAt: mfaFeatureEnabled
          ? safeUser.mfaLastVerifiedAt
          : null,
        mfaEnabled: mfaFeatureEnabled && Boolean(safeUser.mfaEnabledAt),
        mfaSetupPending:
          mfaFeatureEnabled && Boolean(mfaPendingTotpSecretEncrypted),
        mfaRecoveryCodesRemaining: mfaFeatureEnabled
          ? this.countRemainingRecoveryCodes(mfaRecoveryCodes)
          : 0,
      },
      datasets: {
        taskCategories: taskCategories,
        financeCategories: financeCategories.map(toCategoryResponse),
        tasks: tasks.map((task) => ({
          ...task,
          estimatedAmount:
            task.estimatedAmount !== null && task.estimatedAmount !== undefined
              ? Number(task.estimatedAmount)
              : null,
        })),
        transactions: transactions.map((transaction) => ({
          ...transaction,
          amount: Number(transaction.amount),
        })),
        goals: goals.map((goal) => ({
          ...goal,
          targetAmount:
            goal.targetAmount === null || goal.targetAmount === undefined
              ? null
              : Number(goal.targetAmount),
          currentAmount: Number(goal.currentAmount),
        })),
        reminders: reminders,
        insights: insights,
        forecasts: forecasts.map((forecast) => ({
          ...forecast,
          predictedBalance: Number(forecast.predictedBalance),
        })),
        importJobs: importJobs,
        receiptScans: receiptScans.map((receiptScan) => ({
          ...receiptScan,
          totalAmount: Number(receiptScan.totalAmount),
          subtotalAmount:
            receiptScan.subtotalAmount !== null
              ? Number(receiptScan.subtotalAmount)
              : null,
          taxAmount:
            receiptScan.taxAmount !== null ? Number(receiptScan.taxAmount) : null,
          items: receiptScan.items.map((item) => ({
            ...item,
            quantity: Number(item.quantity),
            unitPrice: item.unitPrice !== null ? Number(item.unitPrice) : null,
            totalPrice: Number(item.totalPrice),
          })),
        })),
        notifications,
        tagGroups,
        forecastSnapshots: forecastSnapshots.map((snapshot) => ({
          ...snapshot,
          predictedBalance: Number(snapshot.predictedBalance),
          actualBalance:
            snapshot.actualBalance !== null && snapshot.actualBalance !== undefined
              ? Number(snapshot.actualBalance)
              : null,
          errorPercent:
            snapshot.errorPercent !== null && snapshot.errorPercent !== undefined
              ? Number(snapshot.errorPercent)
              : null,
        })),
        recurringTransactions: recurringTransactions.map((item) => ({
          ...item,
          amount: Number(item.amount),
        })),
        assistantTurns,
        supportRequests,
        authSessions,
      },
    };
  }

  async deleteMe(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user) {
      throw new NotFoundException("Usuario nao encontrado.");
    }

    // 400, nunca 401: o interceptor do front desloga em 401 e o usuario
    // perderia a sessao so por errar a senha.
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new BadRequestException("Senha incorreta.");
    }

    await this.prisma.user.delete({
      where: { id: userId },
    });

    return {
      message: "Conta e dados pessoais excluidos com sucesso.",
      deletedAt: new Date().toISOString(),
    };
  }

  async sanitizeUser(user: Awaited<ReturnType<UsersService["findById"]>>) {
    const {
      passwordHash,
      mfaTotpSecretEncrypted,
      mfaPendingTotpSecretEncrypted,
      mfaRecoveryCodes,
      mfaLastTotpStep,
      ...safeUser
    } = user;
    const mfaFeatureEnabled = this.isMfaFeatureEnabled();

    return {
      ...safeUser,
      monthlyIncome: Number(safeUser.monthlyIncome ?? 0),
      financeCategories: safeUser.financeCategories.map(toCategoryResponse),
      mfaEnabledAt: mfaFeatureEnabled ? safeUser.mfaEnabledAt : null,
      mfaLastVerifiedAt: mfaFeatureEnabled ? safeUser.mfaLastVerifiedAt : null,
      mfaEnabled: mfaFeatureEnabled && Boolean(safeUser.mfaEnabledAt),
      mfaSetupPending:
        mfaFeatureEnabled && Boolean(mfaPendingTotpSecretEncrypted),
      mfaRecoveryCodesRemaining: mfaFeatureEnabled
        ? this.countRemainingRecoveryCodes(mfaRecoveryCodes)
        : 0,
    };
  }

  private isMfaFeatureEnabled() {
    return this.configService.get<boolean>("auth.mfaEnabled") ?? false;
  }

  private countRemainingRecoveryCodes(value: unknown) {
    if (!Array.isArray(value)) {
      return 0;
    }

    return value.filter(
      (item) =>
        item &&
        typeof item === "object" &&
        (!("usedAt" in item) || (item as { usedAt?: string | null }).usedAt === null),
    ).length;
  }
}
