const {
  PrismaClient,
  TransactionType,
  TaskPriority,
  TaskStatus,
  GoalStatus,
} = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = "demo@lumen.local";
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: {
        privacyNoticeAcceptedAt: existing.privacyNoticeAcceptedAt || new Date(),
        privacyNoticeVersion: existing.privacyNoticeVersion || "2026-03-26",
        aiAssistantEnabled: true,
        aiAssistantConsentAt: existing.aiAssistantConsentAt || new Date(),
        aiAssistantConsentVersion:
          existing.aiAssistantConsentVersion || "2026-03-26",
      },
    });
    console.log("Seed already applied. Demo privacy settings refreshed.");
    return;
  }

  const passwordHash = await bcrypt.hash("Demo123!", 10);

  const user = await prisma.user.create({
    data: {
      name: "Marina Costa",
      email,
      passwordHash,
      preferredCurrency: "BRL",
      monthlyIncome: 8500,
      monthClosingDay: 28,
      timezone: "America/Sao_Paulo",
      privacyNoticeAcceptedAt: new Date(),
      privacyNoticeVersion: "2026-03-26",
      aiAssistantEnabled: true,
      aiAssistantConsentAt: new Date(),
      aiAssistantConsentVersion: "2026-03-26",
    },
  });

  const [personalCategory, workCategory, homeCategory] = await Promise.all([
    prisma.taskCategory.create({
      data: {
        userId: user.id,
        name: "Pessoal",
        color: "#7c5cff",
        icon: "self_improvement",
      },
    }),
    prisma.taskCategory.create({
      data: {
        userId: user.id,
        name: "Trabalho",
        color: "#0f9d7a",
        icon: "work",
      },
    }),
    prisma.taskCategory.create({
      data: {
        userId: user.id,
        name: "Casa",
        color: "#f18f01",
        icon: "home",
      },
    }),
  ]);

  const [salaryCategory, foodCategory, billsCategory, leisureCategory] =
    await Promise.all([
      prisma.financeCategory.create({
        data: {
          userId: user.id,
          name: "Salario",
          color: "#10b981",
          icon: "payments",
          type: "INCOME",
        },
      }),
      prisma.financeCategory.create({
        data: {
          userId: user.id,
          name: "Alimentacao",
          color: "#ef4444",
          icon: "restaurant",
          type: "EXPENSE",
        },
      }),
      prisma.financeCategory.create({
        data: {
          userId: user.id,
          name: "Contas",
          color: "#f97316",
          icon: "receipt_long",
          type: "EXPENSE",
        },
      }),
      prisma.financeCategory.create({
        data: {
          userId: user.id,
          name: "Lazer",
          color: "#06b6d4",
          icon: "celebration",
          type: "EXPENSE",
        },
      }),
    ]);

  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: "Viagem para Lisboa",
      description: "Reserva para hospedagem, passagens e passeios.",
      targetAmount: 12000,
      currentAmount: 4700,
      targetDate: new Date(
        new Date().getFullYear(),
        new Date().getMonth() + 5,
        15,
      ),
      status: GoalStatus.ACTIVE,
    },
  });

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(today.getDate() - 3);

  const marketTask = await prisma.task.create({
    data: {
      userId: user.id,
      title: "Ir ao mercado",
      description: "Comprar itens da semana e repor materiais de limpeza.",
      dueDate: tomorrow,
      status: TaskStatus.PENDING,
      priority: TaskPriority.HIGH,
      categoryId: homeCategory.id,
      hasFinancialImpact: true,
      estimatedAmount: 320,
      subtasks: {
        create: [
          { title: "Fazer lista", sortOrder: 0 },
          { title: "Comprar frutas e legumes", sortOrder: 1 },
          { title: "Repor produtos de limpeza", sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.task.create({
    data: {
      userId: user.id,
      title: "Pagar internet",
      description: "Evitar multa e manter home office funcionando.",
      dueDate: today,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.CRITICAL,
      categoryId: homeCategory.id,
      hasFinancialImpact: true,
      estimatedAmount: 129.9,
    },
  });

  await prisma.task.create({
    data: {
      userId: user.id,
      title: "Revisar planejamento trimestral",
      description: "Atualizar metas profissionais e prioridades da equipe.",
      dueDate: nextWeek,
      status: TaskStatus.PENDING,
      priority: TaskPriority.MEDIUM,
      categoryId: workCategory.id,
      linkedGoalId: goal.id,
    },
  });

  await prisma.task.create({
    data: {
      userId: user.id,
      title: "Organizar comprovantes de fevereiro",
      dueDate: threeDaysAgo,
      status: TaskStatus.PENDING,
      priority: TaskPriority.MEDIUM,
      categoryId: personalCategory.id,
    },
  });

  await prisma.transaction.createMany({
    data: [
      {
        userId: user.id,
        type: TransactionType.INCOME,
        description: "Salario principal",
        amount: 8500,
        date: new Date(today.getFullYear(), today.getMonth(), 5),
        categoryId: salaryCategory.id,
      },
      {
        userId: user.id,
        type: TransactionType.EXPENSE,
        description: "Supermercado do mes",
        amount: 540.55,
        date: new Date(today.getFullYear(), today.getMonth(), 8),
        categoryId: foodCategory.id,
        linkedTaskId: marketTask.id,
      },
      {
        userId: user.id,
        type: TransactionType.EXPENSE,
        description: "Conta de energia",
        amount: 198.2,
        date: new Date(today.getFullYear(), today.getMonth(), 10),
        categoryId: billsCategory.id,
      },
      {
        userId: user.id,
        type: TransactionType.EXPENSE,
        description: "Cinema com amigos",
        amount: 96,
        date: new Date(today.getFullYear(), today.getMonth(), 12),
        categoryId: leisureCategory.id,
      },
      {
        userId: user.id,
        type: TransactionType.TRANSFER,
        description: "Aporte meta viagem",
        amount: 700,
        date: new Date(today.getFullYear(), today.getMonth(), 15),
        linkedGoalId: goal.id,
      },
    ],
  });

  await prisma.reminder.createMany({
    data: [
      {
        userId: user.id,
        title: "Lembrar de pagar internet",
        remindAt: new Date(today.getTime() + 1000 * 60 * 90),
      },
      {
        userId: user.id,
        title: "Separar documentos da viagem",
        remindAt: new Date(today.getTime() + 1000 * 60 * 60 * 24 * 2),
        goalId: goal.id,
      },
    ],
  });

  console.log("Seed finished.");
  console.log("Demo user: demo@lumen.local / Demo123!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
