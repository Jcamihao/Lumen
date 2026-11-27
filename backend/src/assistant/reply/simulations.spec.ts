import { DashboardSummary, SpendingAnalysis } from '../assistant.types';
import { buildSimulations } from './simulations';

type GoalInput = DashboardSummary['goals'][number];

function summaryWith(
  options: { balance?: number; monthlyExpenses?: number; currency?: string; goals?: GoalInput[] } = {},
): DashboardSummary {
  return {
    user: { name: 'Ana', preferredCurrency: options.currency ?? 'BRL', monthlyIncome: 5000 },
    tasks: { todayCount: 0, overdueCount: 0, items: [] },
    finances: {
      balance: 0,
      monthlyExpenses: options.monthlyExpenses ?? 0,
      monthlyIncome: 5000,
      recentTransactions: [],
    },
    goals: options.goals ?? [],
    reminders: [],
    insights: [],
    forecast: { predictedBalance: options.balance ?? 2000, riskLevel: 'LOW' },
    notifications: [],
  };
}

const goal = (targetAmount: number | null, currentAmount = 0): GoalInput => ({
  title: 'Viagem',
  currentAmount,
  targetAmount,
  status: 'ACTIVE',
});

const noSpending: SpendingAnalysis = { topVariableCategory: null, avgMonthlySurplus: null };
const lazer: SpendingAnalysis = { topVariableCategory: { name: 'Lazer', total: 600 }, avgMonthlySurplus: 1500 };
const surplus = (avgMonthlySurplus: number): SpendingAnalysis => ({ topVariableCategory: null, avgMonthlySurplus });

const cases: Array<[string, DashboardSummary, string, SpendingAnalysis]> = [
  [
    'categoria variavel, divida com sobra e meta com alvo',
    summaryWith({ monthlyExpenses: 3000, goals: [goal(3000, 500)] }),
    'Tenho uma dívida de R$ 10.500, como organizo?',
    lazer,
  ],
  ['sem categoria: ajuste linear pelas despesas do mes', summaryWith({ monthlyExpenses: 1000, balance: 100 }), 'Quero juntar', noSpending],
  ['sem gasto e sem divida: nenhuma simulacao', summaryWith(), 'oi', noSpending],
  ['divida sem sobra (null): parcelamento linear em 8 meses', summaryWith({ balance: 50 }), 'dívida de 800 reais', noSpending],
  ['divida com sobra zero: parcelamento linear em 8 meses', summaryWith(), 'dívida de 800 reais', surplus(0)],
  ['divida pequena: 1 mes no singular', summaryWith(), 'dívida de 500', surplus(1000)],
  ['divida enorme: teto de 60 meses', summaryWith(), 'dívida de 1.000.000', surplus(1)],
  ['divida com sobra negativa: cai no linear', summaryWith(), 'dívida de 1.200', surplus(-300)],
  ['meta sem alvo nao gera aporte', summaryWith({ goals: [goal(null, 10)] }), 'oi', noSpending],
  ['meta ja concluida nao gera aporte', summaryWith({ goals: [goal(100, 150)] }), 'oi', noSpending],
  ['aporte: 15% do saldo previsto limitado ao que falta', summaryWith({ balance: 100, goals: [goal(1000, 990)] }), 'oi', noSpending],
  ['aporte: saldo previsto negativo nao gera aporte', summaryWith({ balance: -100, goals: [goal(1000)] }), 'oi', noSpending],
  ['moeda USD vale no formato', summaryWith({ currency: 'USD', monthlyExpenses: 800 }), 'oi', noSpending],
  ['moeda vazia cai para BRL', summaryWith({ currency: '', monthlyExpenses: 800 }), 'oi', noSpending],
  [
    'saldo previsto nulo vira zero',
    { ...summaryWith({ monthlyExpenses: 400 }), forecast: { predictedBalance: null as unknown as number, riskLevel: 'LOW' } },
    'oi',
    noSpending,
  ],
];

describe('buildSimulations (caracterizacao)', () => {
  it.each(cases)('%s', (_name, summary, question, spending) => {
    expect(buildSimulations(summary, question, spending)).toMatchSnapshot();
  });

  it('mantem a ordem: gasto, divida e meta', () => {
    const summary = summaryWith({ monthlyExpenses: 3000, balance: 2000, goals: [goal(3000, 500)] });
    const ids = buildSimulations(summary, 'dívida de 10.500', lazer).map((sim) => sim.id);
    expect(ids).toEqual(['expense-trim-category', 'debt-personalized', 'goal-contribution']);
  });
});
