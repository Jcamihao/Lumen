import { DashboardSummary } from '../assistant.types';
import { buildSelahPayload } from './selah-payload';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const SENSITIVE = ['segredo@exemplo.com', 'SEGREDO-ID', 'segredo-token'];

const withExtras = <T extends object>(item: T): T => ({
  ...item,
  id: 'SEGREDO-ID',
  email: 'segredo@exemplo.com',
  token: 'segredo-token',
});

const buildSummary = (): DashboardSummary => ({
  user: withExtras({ name: 'Marina Costa', preferredCurrency: 'USD', monthlyIncome: 7500.5 }),
  tasks: {
    todayCount: 3,
    overdueCount: 2,
    items: [1, 2, 3, 4, 5, 6].map((index) =>
      withExtras({
        title: 'Tarefa ' + index,
        dueDate: '2026-11-14T12:00:00.000Z',
        priority: 'HIGH',
        hasFinancialImpact: true,
        estimatedAmount: 10,
        category: withExtras({ name: 'Cat a@b.com' }),
      }),
    ),
  },
  finances: {
    balance: 1,
    monthlyExpenses: 2,
    monthlyIncome: 3,
    recentTransactions: [1, 2, 3, 4, 5, 6].map((index) =>
      withExtras({
        description: 'Lanc ' + index,
        type: 'EXPENSE',
        amount: index,
        date: '2026-11-12T12:00:00.000Z',
        category: withExtras({ name: 'Merc a@b.com' }),
      }),
    ),
  },
  goals: [1, 2, 3, 4, 5].map((index) =>
    withExtras({ title: 'Meta ' + index + ' a@b.com', currentAmount: 1, targetAmount: 2, status: 'ACTIVE' }),
  ),
  reminders: [1, 2, 3, 4, 5].map((index) => withExtras({ title: 'Lembrete ' + index, remindAt: '2026-11-20T12:00:00.000Z' })),
  insights: [1, 2, 3, 4, 5, 6].map((index) => withExtras({ type: 'TIP', message: 'Dica ' + index, severity: 'INFO' })),
  forecast: withExtras({ predictedBalance: 5, riskLevel: 'HIGH' }),
  notifications: [1, 2, 3, 4, 5].map((index) => withExtras({ title: 'Aviso ' + index, message: 'Msg ' + index })),
});

const build = () => buildSelahPayload(buildSummary(), 'oi', [], 'general');

describe('buildSelahPayload (contrato do payload externo)', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('mantem a ordem das chaves de primeiro nivel', () => {
    expect(Object.keys(build())).toEqual([
      'message', 'intent', 'questionContextSummary', 'matchedQuestionTargets', 'currentDateLabel', 'user',
      'lifeContextSummary', 'applicationPromptContext', 'conversationMemory', 'originModule', 'focusAreaHint',
      'tasksTodayCount', 'tasksOverdueCount', 'currentBalance', 'monthlyExpenses', 'monthlyIncome', 'forecast',
      'openTasks', 'recentTransactions', 'activeGoals', 'activeInsights', 'reminderLabels', 'notificationLabels',
    ]);
  });

  it('cada item e o usuario expoem so as chaves previstas', () => {
    const payload = build();
    expect(Object.keys(payload.user)).toEqual(['name', 'preferredCurrency', 'monthlyIncome']);
    expect(Object.keys(payload.forecast)).toEqual(['predictedBalance', 'riskLevel']);
    expect(Object.keys(payload.openTasks[0])).toEqual([
      'title', 'priority', 'dueDateLabel', 'category', 'hasFinancialImpact', 'estimatedAmount',
    ]);
    expect(Object.keys(payload.recentTransactions[0])).toEqual(['description', 'type', 'amount', 'dateLabel', 'category']);
    expect(Object.keys(payload.activeGoals[0])).toEqual(['title', 'status', 'progressPercent', 'targetDateLabel']);
    expect(Object.keys(payload.activeInsights[0])).toEqual(['type', 'severity', 'message']);
  });

  it('nao vaza id, e-mail nem token extras do resumo', () => {
    const json = JSON.stringify(build());
    SENSITIVE.forEach((value) => expect(json).not.toContain(value));
    expect(json).not.toContain('a@b.com');
  });

  it('corta listas no limite e preserva o valor do usuario', () => {
    const payload = build();
    expect([payload.openTasks, payload.recentTransactions, payload.activeGoals, payload.activeInsights]
      .map((list) => list.length)).toEqual([5, 5, 4, 5]);
    expect([payload.reminderLabels.length, payload.notificationLabels.length]).toEqual([4, 4]);
    expect(payload.user.monthlyIncome).toBe(7500.5);
    expect(payload.user.name).toBe('Marina');
  });
});
