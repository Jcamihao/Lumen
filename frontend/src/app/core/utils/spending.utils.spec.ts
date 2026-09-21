import { Transaction } from '../models/domain.models';
import { buildSpendingBreakdown } from './spending.utils';

describe('buildSpendingBreakdown', () => {
  const category = (id: string, name: string, color = '#111111') => ({
    id,
    name,
    color,
    icon: 'sell',
    type: 'EXPENSE' as const,
  });
  const expense = (amount: number, cat?: ReturnType<typeof category>, type: Transaction['type'] = 'EXPENSE'): Transaction => ({
    id: `${Math.random()}`,
    type,
    description: 'x',
    amount,
    date: '2026-09-10',
    category: cat ?? null,
  });

  it('only counts expenses (income and transfers are not spending)', () => {
    const food = category('food', 'Alimentacao');
    const result = buildSpendingBreakdown([
      expense(100, food),
      expense(5000, food, 'INCOME'),
      expense(300, food, 'TRANSFER'),
    ]);

    expect(result.total).toBe(100);
    expect(result.slices.length).toBe(1);
    expect(result.slices[0].percentLabel).toBe(100);
  });

  it('groups by category, sorts by amount and keeps the category color', () => {
    const food = category('food', 'Alimentacao', '#ef4444');
    const home = category('home', 'Moradia', '#f97316');
    const result = buildSpendingBreakdown([
      expense(100, food),
      expense(300, home),
      expense(100, food),
    ]);

    expect(result.slices.map((slice) => slice.name)).toEqual(['Moradia', 'Alimentacao']);
    expect(result.slices.map((slice) => slice.amount)).toEqual([300, 200]);
    expect(result.slices[0].color).toBe('#f97316');
    expect(result.total).toBe(500);
  });

  it('puts spending without a category in its own "Sem categoria" slice', () => {
    const result = buildSpendingBreakdown([expense(80), expense(20, category('food', 'Alimentacao'))]);

    const uncategorized = result.slices.find((slice) => slice.name === 'Sem categoria');
    expect(uncategorized?.amount).toBe(80);
    expect(uncategorized?.percentLabel).toBe(80);
  });

  it('rounds the displayed percentages so they always add up to 100', () => {
    const result = buildSpendingBreakdown([
      expense(100, category('a', 'A')),
      expense(100, category('b', 'B')),
      expense(100, category('c', 'C')),
    ]);

    expect(result.slices.map((slice) => slice.percentLabel).reduce((a, b) => a + b, 0)).toBe(100);
    expect(result.slices.map((slice) => slice.percentLabel).sort()).toEqual([33, 33, 34]);
  });

  it('merges the smallest categories into "Outros" past the slice limit', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      expense(100 - index * 10, category(`c${index}`, `Cat ${index}`)),
    );
    const result = buildSpendingBreakdown(many);

    expect(result.slices.length).toBe(6);
    const others = result.slices[result.slices.length - 1];
    expect(others.name).toBe('Outros');
    expect(others.isOther).toBeTrue();
    // Cat 5..7 = 50 + 40 + 30
    expect(others.amount).toBe(120);
    expect(result.slices.reduce((sum, slice) => sum + slice.amount, 0)).toBe(result.total);
    expect(result.slices.map((slice) => slice.percentLabel).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('returns an empty breakdown when there is no spending', () => {
    expect(buildSpendingBreakdown([])).toEqual({ total: 0, slices: [] });
    expect(buildSpendingBreakdown([expense(50, undefined, 'INCOME')])).toEqual({ total: 0, slices: [] });
  });
});
