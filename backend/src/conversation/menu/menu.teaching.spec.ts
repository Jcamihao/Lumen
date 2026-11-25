import { matchIntent } from '../parsers/intent.matcher';
import { REPLIES } from '../replies';
import { MENU_ROOT } from './menu.tree';
import { MenuNode } from './menu.types';

/** Frases de ensino: cada uma precisa casar no matcher com a intencao certa (contrato 12.0b, secao 4). */
const TAUGHT: Array<[string, string]> = [
  ['gastei 50 no mercado', 'create_expense'],
  ['recebi 3000 de salario', 'create_income'],
  ['caiu 500 do freela', 'create_income'],
  ['coloquei 200 na minha caixinha', 'contribute_goal'],
  ['comprei um celular em 10x de 150', 'create_installment'],
];

function findNode(node: MenuNode, id: string): MenuNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

describe('ensino das formas naturais', () => {
  it.each(TAUGHT)('"%s" casa como %s', (phrase, intent) => {
    expect(matchIntent(phrase)?.intent).toBe(intent);
  });

  it.each(TAUGHT)('a ajuda mostra "%s"', (phrase) => {
    expect(REPLIES.help).toContain(phrase);
  });

  it('a ajuda nao ensina a forma curta "50 mercado"', () => {
    expect(REPLIES.help).not.toContain('"50 mercado"');
    expect(REPLIES.help).not.toContain('guardar 200 na viagem');
  });

  it.each([
    ['financas.despesa', 'gastei 50 no mercado', 'create_expense'],
    ['financas.receita', 'caiu 500 do freela', 'create_income'],
    ['metas.guardar', 'coloquei 200 na minha caixinha', 'contribute_goal'],
  ])('folha %s ensina "%s" (%s)', (nodeId, phrase, intent) => {
    const node = findNode(MENU_ROOT, nodeId);
    expect(node?.example).toBe(phrase);
    expect(matchIntent(phrase)?.intent).toBe(intent);
  });

  it('nenhuma dica do menu ensina "50 mercado"', () => {
    const examples: string[] = [];
    const walk = (node: MenuNode): void => {
      if (node.example) examples.push(node.example);
      (node.children ?? []).forEach(walk);
    };
    walk(MENU_ROOT);
    expect(examples.filter((example) => example.startsWith('50 '))).toEqual([]);
  });

  it('erro de valor ausente ensina a forma natural', () => {
    expect(REPLIES.amountMissing).toContain('gastei 50 no mercado');
  });
});
