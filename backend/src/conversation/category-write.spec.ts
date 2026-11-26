import { categoryNameTaken, checkCategoryName, nextCategoryColor, parseCategoryCreateBody, parseCategoryType } from './category-write';

describe('category-write', () => {
  it('nome: 2 a 40 letras, espacos colapsados', () => {
    expect(checkCategoryName('  Pets   Casa ')).toEqual({ ok: true, name: 'Pets Casa' });
    expect(checkCategoryName('a')).toMatchObject({ ok: false });
    expect(checkCategoryName('x'.repeat(41))).toMatchObject({ ok: false });
    expect(checkCategoryName('x'.repeat(40))).toMatchObject({ ok: true });
    expect(checkCategoryName('ab')).toMatchObject({ ok: true });
  });

  it.each([
    ['1', 'EXPENSE'],
    ['despesa', 'EXPENSE'],
    ['Gasto', 'EXPENSE'],
    ['2', 'INCOME'],
    ['Receita!', 'INCOME'],
    ['entrada', 'INCOME'],
  ])('tipo "%s" = %s', (answer, type) => {
    expect(parseCategoryType(answer)).toBe(type);
  });

  it.each(['', '3', 'talvez', 'despesa e receita'])('tipo "%s" nao vale', (answer) => {
    expect(parseCategoryType(answer)).toBeNull();
  });

  it('corpo da frase: nome, tipo opcional na frente, ou vazio', () => {
    expect(parseCategoryCreateBody('')).toEqual({ name: null, type: null });
    expect(parseCategoryCreateBody('Pets')).toEqual({ name: 'Pets', type: null });
    expect(parseCategoryCreateBody('receita Freela')).toEqual({ name: 'Freela', type: 'INCOME' });
    expect(parseCategoryCreateBody('despesa Pets Casa')).toEqual({ name: 'Pets Casa', type: 'EXPENSE' });
    expect(parseCategoryCreateBody('receita')).toEqual({ name: 'receita', type: null });
  });

  it('nome repetido: sem acento nem caixa, so no mesmo tipo, ignorando a propria categoria', () => {
    const own = [
      { id: 'a', name: 'Alimentação', type: 'EXPENSE' },
      { id: 'b', name: 'Salário', type: 'INCOME' },
    ];
    expect(categoryNameTaken(own, 'alimentacao', 'EXPENSE')).toBe(true);
    expect(categoryNameTaken(own, 'alimentacao', 'INCOME')).toBe(false);
    expect(categoryNameTaken(own, 'Alimentação', 'EXPENSE', 'a')).toBe(false);
    expect(categoryNameTaken(own, 'Outra', 'EXPENSE')).toBe(false);
  });

  it('cor automatica gira pela paleta', () => {
    expect(nextCategoryColor(0)).toBe(nextCategoryColor(8));
    expect(nextCategoryColor(0)).not.toBe(nextCategoryColor(1));
    expect(nextCategoryColor(3)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
