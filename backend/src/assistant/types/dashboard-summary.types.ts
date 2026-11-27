export type DashboardSummary = {
  user: {
    id?: string;
    name: string;
    preferredCurrency: string;
    monthlyIncome: number;
    birthDate?: Date | string | null;
    occupation?: string | null;
    primaryGoal?: string | null;
  };
  tasks: {
    todayCount: number;
    overdueCount: number;
    items: Array<{
      title: string;
      dueDate?: Date | string | null;
      priority?: string | null;
      hasFinancialImpact?: boolean | null;
      estimatedAmount?: number | null;
      category?: {
        name: string;
      } | null;
    }>;
  };
  finances: {
    balance: number;
    monthlyExpenses: number;
    monthlyIncome: number;
    recentTransactions: Array<{
      description: string;
      type: string;
      amount: number;
      date: Date | string;
      category?: {
        name: string;
      } | null;
    }>;
  };
  goals: Array<{
    title: string;
    currentAmount: number;
    /** null = cofrinho sem valor-alvo definido. */
    targetAmount: number | null;
    status: string;
    targetDate?: Date | string | null;
  }>;
  reminders: Array<{
    title: string;
    remindAt: Date | string;
  }>;
  insights: Array<{
    type: string;
    message: string;
    severity: string;
    /** type:key:severity, ver InsightsService.fingerprintOf */
    fingerprint?: string;
    metadata?: { persona?: { name?: string; role?: string } } | null;
  }>;
  forecast: {
    predictedBalance: number;
    riskLevel: string;
  };
  notifications: Array<{
    title: string;
    message: string;
  }>;
};
