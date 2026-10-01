export type User = {
  id: string;
  name: string;
  email: string;
  role?: 'USER' | 'ADMIN';
  avatarUrl?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  occupation?: string | null;
  primaryGoal?: string | null;
  preferredCurrency: string;
  monthlyIncome: number;
  monthClosingDay: number;
  timezone: string;
  privacyNoticeAcceptedAt?: string | null;
  privacyNoticeVersion?: string | null;
  aiAssistantEnabled?: boolean;
  aiAssistantConsentAt?: string | null;
  aiAssistantConsentVersion?: string | null;
  emailVerifiedAt?: string | null;
  emailWeeklyDigest?: boolean;
  emailReminders?: boolean;
  emailInsightAlerts?: boolean;
  emailBillReminders?: boolean;
  mfaEnabled?: boolean;
  mfaSetupPending?: boolean;
  mfaEnabledAt?: string | null;
  mfaLastVerifiedAt?: string | null;
  mfaRecoveryCodesRemaining?: number;
  taskCategories: Category[];
  financeCategories: FinanceCategory[];
  tagGroups: TagGroup[];
};

export type Category = {
  id: string;
  name: string;
  color: string;
  icon?: string;
};

export type FinanceCategory = Category & {
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  /** Teto mensal de gastos (so despesas); null/ausente = sem orcamento. */
  monthlyBudget?: number | null;
};

export type TagGroup = {
  id: string;
  name: string;
  color: string | null;
  isDefault: boolean;
  sortOrder: number;
};

export type Task = {
  id: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  hasFinancialImpact: boolean;
  estimatedAmount?: number | null;
  isRecurring: boolean;
  recurrenceRule?: string | null;
  streakCount: number;
  longestStreak: number;
  category?: Category | null;
  subtasks: Array<{
    id: string;
    title: string;
    isCompleted: boolean;
  }>;
};

/** Como o dinheiro se moveu. Credito e so uma etiqueta: nao gera fatura nem parcela. */
export type PaymentMethod = "PIX" | "CREDIT" | "DEBIT";

export type Transaction = {
  id: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  description: string;
  amount: number;
  date: string;
  category?: FinanceCategory | null;
  /** Preenchido quando o lancamento foi gerado por uma conta fixa. */
  recurringTransactionId?: string | null;
  /** PIX, credito ou debito; ausente/nulo = nao informado. */
  paymentMethod?: PaymentMethod | null;
  /** Preenchido quando a transacao foi marcada como parte de um envelope (ex.: gasolina). */
  envelopeId?: string | null;
  /** So name/color/icon confiaveis aqui; para o valor mensal use a lista de /envelopes. */
  envelope?: { id: string; name: string; color: string; icon: string | null } | null;
  /** Preenchidos quando o lancamento e uma parcela de uma compra parcelada. */
  installmentPurchaseId?: string | null;
  installmentNumber?: number | null;
  installmentsTotal?: number | null;
};

export type RecurrenceFrequency = "WEEKLY" | "MONTHLY" | "YEARLY";

/** Conta fixa ou recorrente: gera um lancamento sozinha a cada vencimento. */
export type RecurringTransaction = {
  id: string;
  type: "INCOME" | "EXPENSE";
  description: string;
  amount: number;
  categoryId?: string | null;
  category?: FinanceCategory | null;
  paymentMethod?: PaymentMethod | null;
  frequency: RecurrenceFrequency;
  /** Dia do mes de referencia (mensal/anual). */
  anchorDay: number;
  /** Proximo vencimento (AAAA-MM-DDT00:00:00.000Z). */
  nextDueDate: string;
  endDate?: string | null;
  isActive: boolean;
};

/** Compra parcelada no credito: gera 1 parcela por mes ate installmentsTotal. */
export type InstallmentPurchase = {
  id: string;
  description: string;
  totalAmount: number;
  /** Valor de cada parcela, exceto a ultima (que absorve a sobra do arredondamento). */
  installmentAmount: number;
  installmentsTotal: number;
  installmentsGenerated: number;
  categoryId?: string | null;
  category?: FinanceCategory | null;
  paymentMethod?: PaymentMethod | null;
  anchorDay: number;
  /** Proxima parcela a gerar (AAAA-MM-DDT00:00:00.000Z); null quando ja gerou todas. */
  nextDueDate: string | null;
  isActive: boolean;
  /** Calculados pelo backend a partir de installmentsGenerated. */
  paidAmount: number;
  remainingAmount: number;
  remainingInstallments: number;
};

export type Goal = {
  id: string;
  title: string;
  description?: string | null;
  /** null = "cofrinho" sem propósito definido (ex.: reserva de emergência). */
  targetAmount: number | null;
  currentAmount: number;
  targetDate?: string | null;
  status: "PLANNED" | "ACTIVE" | "ACHIEVED" | "PAUSED";
  recurringAmount?: number | null;
  recurringDay?: number | null;
};

export type Reminder = {
  id: string;
  title: string;
  remindAt: string;
};

export type InsightPersona = {
  name: string;
  role: string;
};

export type Insight = {
  id: string;
  type: "PRODUCTIVITY" | "FINANCE" | "GOAL" | "ROUTINE";
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  /** Carimbado pelo backend em insights.service. Ausente em insights gerados offline. */
  metadata?: {
    persona?: InsightPersona;
    [key: string]: unknown;
  } | null;
};

export type Forecast = {
  id: string;
  predictedBalance: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
};

export type ForecastAccuracy = {
  targetDate: string;
  predictedBalance: number;
  actualBalance: number;
  errorPercent: number;
  resolvedAt: string;
};

export type Notification = {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};


export type NotificationCenterEntry = {
  id: string;
  kind: "notification" | "reminder";
  title: string;
  description: string;
  date: string;
  isRead: boolean;
};

export type OfflineSyncQueueItem = {
  id: string;
  entity:
    | "task"
    | "transaction"
    | "goal"
    | "user"
    | "reminder"
    | "notification"
    | "supportRequest";
  action: "create" | "update" | "delete" | "contribute" | "read";
  recordId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "syncing" | "failed";
  retryCount: number;
  lastAttemptAt?: string | null;
  lastError?: string | null;
};

/** O usuario ja fez cada primeiro passo? (calculado pelo backend no resumo do dashboard) */
export type OnboardingProgress = {
  tasks: boolean;
  transactions: boolean;
  goals: boolean;
  recurring: boolean;
  selah: boolean;
};

export type DashboardSummary = {
  user: {
    id: string;
    name: string;
    preferredCurrency: string;
    monthlyIncome: number;
  };
  tasks: {
    todayCount: number;
    overdueCount: number;
    items: Task[];
  };
  finances: {
    balance: number;
    monthlyExpenses: number;
    monthlyIncome: number;
    recentTransactions: Transaction[];
  };
  goals: Goal[];
  reminders: Reminder[];
  insights: Insight[];
  forecast: Forecast;
  notifications: Notification[];
  /** Ausente no modo offline ou em resumo antigo em cache: nesse caso nao ha onboarding. */
  onboarding?: OnboardingProgress;
};

export type AssistantModule =
  | "dashboard"
  | "tasks"
  | "finances"
  | "goals"
  | "imports"
  | "general";

export type AssistantAction = {
  id: string;
  kind: "create_task" | "create_goal" | "create_reminder" | "open_module";
  title: string;
  description: string;
  targetModule: AssistantModule;
  importance: "low" | "medium" | "high";
  route: string | null;
  payload: Record<string, unknown> | null;
};

export type AssistantProactiveSignal = {
  id: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  targetModule: AssistantModule;
  suggestedPrompt: string | null;
  suggestedActionLabel: string | null;
};

export type AssistantSimulation = {
  id: string;
  title: string;
  summary: string;
  monthlyDelta: number;
  projectedBalance: number;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
};

export type AssistantContinuity = {
  historyCount: number;
  memorySummary: string | null;
  nextQuestion: string | null;
  followUpPrompt: string | null;
  originModule: AssistantModule | null;
};

export type AssistantExplainability = {
  reasoning: string[];
  evidence: string[];
  confidenceReason: string;
};

export type AssistantPulse = {
  summary: string;
  suggestedQuestion: string;
  generatedAt: string;
  signals: AssistantProactiveSignal[];
  actions: AssistantAction[];
};

export type AuthResponse = {
  accessToken: string;
  refreshToken?: string;
  user: User;
};

export type LoginMfaChallengeResponse = {
  requiresMfa: true;
  challengeId: string;
  challengeExpiresAt: string;
  availableMethods: Array<"totp" | "recovery_code">;
};

export type MfaBypassChallengeResponse = {
  bypassChallengeId: string;
  expiresAt: string;
};

export type LoginResult = AuthResponse | LoginMfaChallengeResponse;

export type MfaSetupResponse = {
  secret: string;
  otpauthUrl: string;
  issuer: string;
  accountName: string;
};

export type MfaConfirmResponse = {
  success: boolean;
  recoveryCodes: string[];
  user: User;
};

export type MfaDisableResponse = {
  success: boolean;
  user: User;
};

export type AssistantReply = {
  answer: string;
  highlights: string[];
  suggestedActions: string[];
  actions: AssistantAction[];
  proactiveSignals: AssistantProactiveSignal[];
  simulations: AssistantSimulation[];
  continuity: AssistantContinuity;
  explainability: AssistantExplainability;
  source?: "selah_ia" | "lumen_fallback";
  provider?: string;
  focusArea?: string;
  confidence?: "low" | "medium" | "high";
  disclaimer?: string | null;
  generatedAt?: string;
  model?: string;
};

export type ImportPreview = {
  importJobId: string;
  fileName: string;
  totalRows: number;
  duplicates: number;
  rows: Array<{
    type: "INCOME" | "EXPENSE" | "TRANSFER";
    description: string;
    amount: number;
    date: string;
    categoryName?: string;
    duplicate: boolean;
  }>;
};

export type ReceiptImportItem = {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
  categoryHint?: string | null;
  priceComparison?: ReceiptImportItemPriceComparison | null;
};

export type ReceiptImportItemPriceHistoryEntry = {
  merchantName: string | null;
  purchaseDate: string | null;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
};

export type ReceiptImportItemPriceComparison = {
  matchKey: string;
  historyCount: number;
  lowestUnitPrice: number;
  averageUnitPrice: number;
  latestUnitPrice: number;
  cheapestMerchantName: string | null;
  cheapestPurchaseDate: string | null;
  currentUnitPrice: number | null;
  currentVsLowestAmount: number | null;
  currentVsLowestPercent: number | null;
  history: ReceiptImportItemPriceHistoryEntry[];
};

export type ReceiptImportPreview = {
  receiptScanId: string;
  fileName: string;
  merchantName: string | null;
  merchantTaxId: string | null;
  documentType: string | null;
  accessKey: string | null;
  purchaseDate: string | null;
  totalAmount: number;
  subtotalAmount: number | null;
  taxAmount: number | null;
  confidence: "low" | "medium" | "high";
  qrCodeDetected: boolean;
  qrCodeText: string | null;
  purchaseSummary: string | null;
  purchaseMission: string | null;
  spendingSignals: string[];
  followUpActions: string[];
  categoryBreakdown: Array<{
    label: string;
    totalAmount: number;
    itemCount: number;
  }>;
  notes: string[];
  rawTextExcerpt: string | null;
  possibleDuplicate: boolean;
  duplicateTransactionId: string | null;
  duplicateTransactionDescription: string | null;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  descriptionSuggestion: string;
  items: ReceiptImportItem[];
};

export type ReceiptImportCommitResponse = {
  success: boolean;
  receiptScanId: string;
  importedItems: number;
  transaction: Transaction;
};

export type GoalContribution = {
  id: string;
  description: string;
  amount: number;
  date: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
};

export type ReceiptScanHistoryEntry = {
  id: string;
  fileName: string;
  merchantName: string | null;
  totalAmount: number;
  status: string;
  importedAt: string | null;
  createdAt: string;
};

export type ImportJobHistoryEntry = {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  importedRows: number;
  deduplicatedRows: number;
  createdAt: string;
};

export type PrivacyExportPayload = {
  exportedAt: string;
  [key: string]: unknown;
};

export type AssistantHistoryTurn = {
  id: string;
  question: string;
  answer: string;
  focusArea: string | null;
  source: string | null;
  createdAt: string;
};

export type SupportRequest = {
  id: string;
  type: string;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';
  severity: string | null;
  subject: string;
  message: string;
  emailSnapshot: string;
  screenPath: string | null;
  appVersion: string | null;
  /** Nota 1-5 da pagina de feedback (ausente em bug report e suporte). */
  rating?: number | null;
  area?: string | null;
  /** O usuario autorizou a equipe a chamar para conversar sobre este feedback. */
  canContact?: boolean;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string; email: string };
};

/** Valor reservado que recarrega todo mes e nao desconta de nenhum teto geral. */
export type Envelope = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  monthlyAmount: number;
  isActive: boolean;
  deposited: number;
  spent: number;
  /** Pode ficar negativo se o usuario gastou mais do que tinha guardado. */
  available: number;
};

export type CreditCycleStatus = 'none' | 'ok' | 'near' | 'over';

/** Ciclo de credito aberto agora: teto editavel, gasto e quanto falta. */
export type CreditCycle = {
  closingDay: number;
  dueDay: number | null;
  /** true: o teto soma toda despesa do ciclo (credito+debito+PIX+boleto), nao so credito. */
  countAllPayments: boolean;
  cycleStart: string;
  cycleEnd: string;
  ceiling: number | null;
  spent: number;
  remaining: number | null;
  percentUsed: number | null;
  status: CreditCycleStatus;
  /** Teto do ciclo anterior, sugerido no formulario quando o atual ainda nao tem um. */
  previousCeiling: number | null;
};

export type FeedbackSummary = {
  total: number;
  averageRating: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  byArea: Array<{ area: string; count: number; averageRating: number | null }>;
};

export type PlanId = 'FREE' | 'INDIVIDUAL' | 'SHARED';

export type LimitedResource =
  | 'goals'
  | 'envelopes'
  | 'recurringTransactions'
  | 'installmentPurchases';

export type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';

export type SubscriptionSource = 'ASAAS' | 'GRANT';

export type PublicPlan = {
  id: PlanId;
  label: string;
  sellable: boolean;
  seats: number;
  limits: Record<LimitedResource, number | null>;
  selahQuestionsPerMonth: number | null;
  prices: { MONTHLY: number; YEARLY: number } | null;
};

export type UsageLine = {
  used: number;
  limit: number | null;
};

export type UsageReport = {
  enforced: boolean;
  plan: PlanId;
  resources: Record<LimitedResource, UsageLine>;
  selahQuestions: UsageLine & { resetsAt: string };
};

export type BillingMe = {
  enabled: boolean;
  plan: PlanId;
  status: SubscriptionStatus | null;
  source: SubscriptionSource | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  latestInvoiceUrl: string | null;
  usage: UsageReport;
};

export type GrantView = {
  id: string;
  email: string;
  name: string;
  plan: 'INDIVIDUAL' | 'SHARED';
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  createdAt: string;
};
