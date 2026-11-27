import { DashboardSummary } from '../assistant.types';
import { buildLocalReply } from './local-reply';

const baseSummary = (overrides: Partial<DashboardSummary> = {}): DashboardSummary => ({
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

const task = (title: string, dueDate: string | null) => ({ title, dueDate });
const goal = (title: string) => ({ title, currentAmount: 1, targetAmount: 4, status: 'ACTIVE' });

describe('buildLocalReply (limites e secoes)', () => {
  it('prioridades listam so as tres primeiras tarefas, com prazo quando existe', () => {
    const items = [task('A', '2026-11-20T12:00:00.000Z'), task('B', null), task('C', null), task('D', null)];
    const reply = buildLocalReply(baseSummary({ tasks: { todayCount: 0, overdueCount: 0, items } }), 'prioriza meu dia', null);
    expect(reply.answer).toBe(
      'Hoje eu puxaria a fila por A (20 de nov.), B, C. Comece pelo que vence antes, tem impacto financeiro ou destrava o resto do dia.',
    );
    expect(reply.focusArea).toBe('Prioridades');
  });

  it('destaques usam so as duas primeiras metas', () => {
    const reply = buildLocalReply(baseSummary({ goals: [goal('G1'), goal('G2'), goal('G3')] }), 'oi', null);
    expect(reply.highlights).toEqual(['Meta G1: 25% concluida.', 'Meta G2: 25% concluida.']);
  });

  it('um unico alerta critico aparece no singular de contagem', () => {
    const insights = [{ type: 'TIP', message: 'm', severity: 'CRITICAL' }];
    const reply = buildLocalReply(baseSummary({ insights }), 'oi', null);
    expect(reply.answer).toContain('e 1 alerta(s) critico(s). A previsao');
  });

  it('mantem a ordem das chaves e nao adiciona campos', () => {
    expect(Object.keys(buildLocalReply(baseSummary(), 'oi', null))).toEqual([
      'answer', 'highlights', 'suggestedActions', 'actions', 'proactiveSignals', 'simulations', 'continuity',
      'explainability', 'source', 'provider', 'focusArea', 'confidence', 'disclaimer', 'generatedAt',
    ]);
  });
});
