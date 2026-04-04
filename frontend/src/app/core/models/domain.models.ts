export type User = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  preferredCurrency: string;
  monthlyIncome: number;
  monthClosingDay: number;
  timezone: string;
  privacyNoticeAcceptedAt?: string | null;
  privacyNoticeVersion?: string | null;
  aiAssistantEnabled?: boolean;
  aiAssistantConsentAt?: string | null;
  aiAssistantConsentVersion?: string | null;
  mfaEnabled?: boolean;
  mfaSetupPending?: boolean;
  mfaEnabledAt?: string | null;
  mfaLastVerifiedAt?: string | null;
  mfaRecoveryCodesRemaining?: number;
  taskCategories: Category[];
  financeCategories: FinanceCategory[];
};

export type Category = {
  id: string;
  name: string;
  color: string;
  icon?: string;
};

export type FinanceCategory = Category & {
  type: "INCOME" | "EXPENSE" | "TRANSFER";
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
  category?: Category | null;
  subtasks: Array<{
    id: string;
    title: string;
    isCompleted: boolean;
  }>;
};

export type Transaction = {
  id: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  description: string;
  amount: number;
  date: string;
  category?: FinanceCategory | null;
};

export type Goal = {
  id: string;
  title: string;
  description?: string | null;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string | null;
  status: "PLANNED" | "ACTIVE" | "ACHIEVED" | "PAUSED";
};

export type Reminder = {
  id: string;
  title: string;
  remindAt: string;
};

export type Insight = {
  id: string;
  type: "PRODUCTIVITY" | "FINANCE" | "GOAL" | "ROUTINE";
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
};

export type Forecast = {
  id: string;
  predictedBalance: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
};

export type Notification = {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

export type SupportRequest = {
  id: string;
  type: "FEEDBACK" | "BUG_REPORT";
  status: "OPEN" | "REVIEWED" | "RESOLVED";
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  subject: string;
  message: string;
  emailSnapshot: string;
  screenPath?: string | null;
  appVersion?: string | null;
  deviceInfo?: string | null;
  createdAt: string;
  updatedAt: string;
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

export type PrivacyExportPayload = {
  exportedAt: string;
  [key: string]: unknown;
};
