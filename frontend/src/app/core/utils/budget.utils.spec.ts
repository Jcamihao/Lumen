import { FinanceCategory, Transaction } from '../models/domain.models';
import { buildBudgetRows } from './budget.utils';

const category = (
  id: string,
  name: string,
  monthlyBudget: number | null = null,
  type: FinanceCategory['type'] = 'EXPENSE',
): FinanceCategory => ({ id, name, color: '#000', type, monthlyBudget });

const expense = (categoryId: string | null, amount: number): Transaction => ({
  id: `tx-${Math.random()}`,
  type: 'EXPENSE',
  description: 'gasto',
  amount,
  date: '2026-09-10T00:00:00.000Z',
  category: categoryId ? category(categoryId, categoryId) : null,
});

describe('buildBudgetRows', () => {
  it('cobre so categorias de despesa', () => {
    const rows = buildBudgetRows(
      [category('food', 'Alimentação'), category('salary', 'Salário', null, 'INCOME')],
      [],
    );

    expect(rows.map((row) => row.id)).toEqual(['food']);
  });

  it('marca "none" e nao calcula percentual sem orcamento', () => {
    const [row] = buildBudgetRows([category('food', 'Alimentação')], [expense('food', 300)]);

    expect(row.status).toBe('none');
    expect(row.budget).toBeNull();
    expect(row.spent).toBe(300);
    expect(row.remaining).toBeNull();
  });

  it('classifica ok / near / over nos limiares de 80% e 100%', () => {
    const rows = buildBudgetRows(
      [category('a', 'A', 1000), category('b', 'B', 1000), category('c', 'C', 1000), category('d', 'D', 1000)],
      [expense('a', 790), expense('b', 800), expense('c', 999), expense('d', 1000)],
    );
    const status = Object.fromEntries(rows.map((row) => [row.id, row.status]));

    expect(status).toEqual({ a: 'ok', b: 'near', c: 'near', d: 'over' });
  });

  it('arredonda o percentual para baixo e limita a barra em 100%', () => {
    const [row] = buildBudgetRows([category('food', 'Alimentação', 1000)], [expense('food', 1129.9)]);

    expect(row.percentLabel).toBe(112);
    expect(row.barPercent).toBe(100);
    expect(row.remaining).toBeCloseTo(-129.9);
  });

  it('soma varias transacoes e ignora receitas e gasto sem categoria', () => {
    const income: Transaction = { ...expense('food', 5000), type: 'INCOME' };
    const [row] = buildBudgetRows(
      [category('food', 'Alimentação', 1000)],
      [expense('food', 200), expense('food', 250), expense(null, 900), income],
    );

    expect(row.spent).toBe(450);
    expect(row.percentLabel).toBe(45);
  });

  it('ordena: com orcamento primeiro (mais consumido antes), depois por gasto', () => {
    const rows = buildBudgetRows(
      [category('x', 'X'), category('y', 'Y', 1000), category('z', 'Z', 1000), category('w', 'W')],
      [expense('x', 10), expense('y', 300), expense('z', 900), expense('w', 500)],
    );

    expect(rows.map((row) => row.id)).toEqual(['z', 'y', 'w', 'x']);
  });
});
