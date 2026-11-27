import { DashboardSummary } from '../assistant.types';
import { AskAssistantHistoryItemDto } from '../dto/ask-assistant.dto';
import { buildSelahPayload } from './selah-payload';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const HOUR_PATTERN = /(\d{2}\/\d{2}), \d{2}:\d{2}/g;

type Payload = ReturnType<typeof buildSelahPayload>;

const emptySummary = (): DashboardSummary => ({
  user: { name: '', preferredCurrency: '', monthlyIncome: 0 },
  tasks: { todayCount: 0, overdueCount: 0, items: [] },
  finances: { balance: 0, monthlyExpenses: 0, monthlyIncome: 0, recentTransactions: [] },
  goals: [],
  reminders: [],
  insights: [],
  forecast: { predictedBalance: 0, riskLevel: '' },
  notifications: [],
});

const task = (index: number): DashboardSummary['tasks']['items'][number] => ({
  title: `Tarefa ${index} marina@exemplo.com`,
  dueDate: '2026-11-14T12:00:00.000Z',
  priority: 'HIGH_PRIORITY',
  hasFinancialImpact: index % 2 === 0,
  estimatedAmount: index % 2 === 0 ? 1200.9 : null,
  category: index % 3 === 0 ? null : { name: 'Financas' },
});

const transaction = (index: number): DashboardSummary['finances']['recentTransactions'][number] => ({
  description: `Lancamento ${index} (11) 91234-5678`,
  type: index % 2 === 0 ? 'EXPENSE' : 'INCOME',
  amount: 10.5 * index,
  date: '2026-11-12T12:00:00.000Z',
  category: index === 1 ? null : { name: 'Mercado' },
});

const fullSummary = (): DashboardSummary => ({
  user: { name: 'Marina Costa da Silva', preferredCurrency: 'USD', monthlyIncome: 7500.5 },
  tasks: { todayCount: 3, overdueCount: 2, items: [1, 2, 3, 4, 5, 6, 7].map(task) },
  finances: {
    balance: 980.1,
    monthlyExpenses: 6100,
    monthlyIncome: 7500.5,
    recentTransactions: [1, 2, 3, 4, 5, 6].map(transaction),
  },
  goals: [
    { title: 'Viagem', currentAmount: 500, targetAmount: 2000, status: 'ACTIVE', targetDate: '2027-03-01T12:00:00.000Z' },
    { title: 'Cofrinho', currentAmount: 90, targetAmount: null, status: 'ACTIVE' },
    { title: 'Reserva', currentAmount: 3000, targetAmount: 3000, status: 'COMPLETED' },
    { title: 'Carro', currentAmount: 1, targetAmount: 9, status: 'PAUSED', targetDate: null },
    { title: 'Casa', currentAmount: 0, targetAmount: 1, status: 'ACTIVE' },
  ],
  reminders: [1, 2, 3, 4, 5].map((index) => ({ title: `Pagar conta ${index}`, remindAt: '2026-11-20T12:00:00.000Z' })),
  insights: [
    { type: 'SPENDING_SPIKE', message: 'Gasto subiu. Contato: 123.456.789-09.', severity: 'CRITICAL' },
    { type: 'LOW_BALANCE', message: 'Saldo baixo.', severity: 'WARNING' },
    { type: 'TIP', message: 'Dica 3', severity: 'INFO' },
    { type: 'TIP', message: 'Dica 4', severity: 'INFO' },
    { type: 'TIP', message: 'Dica 5', severity: 'INFO' },
    { type: 'TIP', message: 'Dica 6', severity: 'INFO' },
  ],
  forecast: { predictedBalance: 1543.25, riskLevel: 'HIGH' },
  notifications: [1, 2, 3, 4, 5].map((index) => ({ title: `Aviso ${index}`, message: `Mensagem ${index}` })),
});

const history: AskAssistantHistoryItemDto[] = [
  { question: 'Como pago a divida?', answer: 'Liste credores e juros.', focusArea: 'Financeiro' },
  { question: 'Oi', answer: 'Ola! ' + 'x'.repeat(200) },
  { question: 'Prioridades?', answer: 'Comece pelo que vence.', focusArea: 'Prioridades' },
  { question: 'Quarto item', answer: 'descartado' },
];

const cases: Array<[string, DashboardSummary, string, AskAssistantHistoryItemDto[]]> = [
  ['resumo vazio e pergunta curta', emptySummary(), 'oi', []],
  ['listas longas cortam em top N com dados sensiveis', fullSummary(), 'Como estou com a divida e os gastos?', history],
  ['saldo previsto nulo e risco vazio', { ...emptySummary(), forecast: { predictedBalance: null as unknown as number, riskLevel: '' } }, 'prioriza minhas tarefas', []],
  ['sem tarefas nem metas, com transacoes', { ...fullSummary(), tasks: { todayCount: 0, overdueCount: 0, items: [] }, goals: [] }, 'quero juntar', []],
];

/** Troca so a hora local (depende do fuso do ambiente) por um marcador; o dia/mes continua comparado. */
const stable = (payload: Payload) => JSON.parse(JSON.stringify(payload).replace(HOUR_PATTERN, '$1, <hora>'));

describe('buildSelahPayload (caracterizacao)', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it.each(cases)('%s', (_name, summary, question, items) => {
    expect(stable(buildSelahPayload(summary, question, items, 'general'))).toMatchSnapshot();
  });

  it('o horario do lembrete aparece no rotulo, mesmo que o fuso mude a hora', () => {
    const [label] = buildSelahPayload(fullSummary(), 'oi', [], 'general').reminderLabels;
    expect(label).toMatch(/^Pagar conta 1 em 20\/11, \d{2}:\d{2}$/);
  });
});
