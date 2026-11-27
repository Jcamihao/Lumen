import { DashboardSummary } from '../assistant.types';
import { buildLocalReply } from './local-reply';

const NOW = new Date('2026-11-15T12:00:00.000Z');

type Insight = DashboardSummary['insights'][number];

const insight = (message: string, severity = 'INFO'): Insight => ({ type: 'TIP', message, severity });

const summaryWith = (overrides: Partial<DashboardSummary> = {}): DashboardSummary => ({
  user: { name: 'Ana', preferredCurrency: 'BRL', monthlyIncome: 5000 },
  tasks: { todayCount: 0, overdueCount: 0, items: [] },
  finances: { balance: 0, monthlyExpenses: 0, monthlyIncome: 0, recentTransactions: [] },
  goals: [],
  reminders: [],
  insights: [],
  forecast: { predictedBalance: 0, riskLevel: 'LOW' },
  notifications: [],
  ...overrides,
});

const task = (title: string, dueDate: string | null = '2026-11-20T12:00:00.000Z') => ({ title, dueDate });
const goal = (title: string, targetAmount: number | null, currentAmount = 0) => ({
  title,
  currentAmount,
  targetAmount,
  status: 'ACTIVE',
});

const sevenCritical = Array.from({ length: 7 }, (_, i) => insight(`Alerta critico ${i + 1}`, 'CRITICAL'));

const cases: Array<[string, DashboardSummary, string, string | null]> = [
  ['prioridades sem tarefas', summaryWith(), 'prioriza tudo', null],
  [
    'prioridades com quatro tarefas: so tres entram, sem prazo na segunda',
    summaryWith({
      tasks: { todayCount: 1, overdueCount: 1, items: [task('Pagar boleto'), task('Ligar', null), task('Enviar'), task('Quarta')] },
    }),
    'Quais as prioridades?',
    'Aviso de teste',
  ],
  [
    'financas com risco alto, sete alertas criticos e meta sem alvo',
    summaryWith({
      insights: sevenCritical,
      goals: [goal('Cofrinho', null, 150), goal('Viagem', 1000, 250)],
      forecast: { predictedBalance: -350.5, riskLevel: 'HIGH' },
      finances: { balance: 1200.4, monthlyExpenses: 900, monthlyIncome: 2000, recentTransactions: [] },
    }),
    'Como esta minha divida e meus gastos?',
    null,
  ],
  [
    'financas com risco medio e moeda USD',
    summaryWith({
      user: { name: 'Ana', preferredCurrency: 'USD', monthlyIncome: 5000 },
      forecast: { predictedBalance: 99.99, riskLevel: 'MEDIUM' },
      finances: { balance: 10, monthlyExpenses: 1234.5, monthlyIncome: 0, recentTransactions: [] },
    }),
    'saldo?',
    null,
  ],
  [
    'hoje com atraso, previsao nula e moeda vazia cai para BRL',
    summaryWith({
      user: { name: 'Ana', preferredCurrency: '', monthlyIncome: 0 },
      tasks: { todayCount: 2, overdueCount: 2, items: [task('Revisar contas')] },
      forecast: { predictedBalance: null as unknown as number, riskLevel: 'HIGH' },
    }),
    'Como estou hoje?',
    'Dados parciais.',
  ],
  [
    'pergunta geral sem alertas: destaques e acoes padrao',
    summaryWith({ goals: [goal('Reserva', 3000, 3000)] }),
    'oi',
    null,
  ],
  ['pergunta geral sem metas nem insights', summaryWith(), 'obrigado', null],
];

describe('buildLocalReply (caracterizacao)', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it.each(cases)('%s', (_name, summary, question, disclaimer) => {
    expect(buildLocalReply(summary, question, disclaimer)).toMatchSnapshot();
  });
});
