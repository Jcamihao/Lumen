import { matchIntent } from '../parsers/intent.matcher';
import { MENU_ROOT, MENU_ROOT_ID } from './menu.tree';
import { getMenuNode, listChildren, parentOf, validateMenuTree } from './menu.tree.queries';
import { MenuNode } from './menu.types';

function leaves(node: MenuNode = MENU_ROOT): MenuNode[] {
  if (!node.children) return [node];
  return node.children.flatMap((child) => leaves(child));
}

function clone(node: MenuNode): MenuNode {
  return JSON.parse(JSON.stringify(node)) as MenuNode;
}

describe('arvore do menu', () => {
  it('toda area (grupo abaixo da raiz) tem frase de abertura', () => {
    for (const area of MENU_ROOT.children ?? []) {
      if (area.children) expect({ id: area.id, intro: !!area.intro }).toEqual({ id: area.id, intro: true });
    }
  });

  it('toda opcao abaixo da raiz tem guia curto (ate 45 caracteres)', () => {
    const walk = (node: MenuNode): MenuNode[] => [node, ...(node.children ?? []).flatMap(walk)];
    const options = walk(MENU_ROOT).filter((node) => node.id !== MENU_ROOT_ID);
    for (const node of options) {
      expect({ id: node.id, ok: !!node.guide && node.guide.length <= 45 }).toEqual({ id: node.id, ok: true });
    }
  });

  it('e valida: ids unicos, formato, grupo x folha, sem ciclo', () => {
    expect(validateMenuTree(MENU_ROOT)).toEqual([]);
  });

  it('todo id cabe em 64 bytes e usa so [a-z0-9_:.-]', () => {
    const ids = [MENU_ROOT, ...leaves(MENU_ROOT)].map((node) => node.id);
    for (const id of ids) {
      expect(Buffer.byteLength(id, 'utf8')).toBeLessThanOrEqual(64);
      expect(id).toMatch(/^[a-z0-9_:.-]{1,40}$/);
    }
  });

  it('raiz e o menu inicial com as cinco areas do contrato; Tarefas, Avisos e Conta ficam fora', () => {
    expect(MENU_ROOT.id).toBe(MENU_ROOT_ID);
    expect(listChildren(MENU_ROOT_ID).map((node) => node.id)).toEqual(['inicio', 'financas', 'cartao', 'metas', 'ajuda']);
    const titles = [MENU_ROOT, ...leaves(MENU_ROOT)].map((node) => node.title.replace(/^\S+\s/, ''));
    for (const forbidden of ['Tarefas', 'Avisos', 'Conta', 'Selah', 'Configurações']) {
      expect(titles).not.toContain(forbidden);
    }
  });

  it('toda folha de frase casa com o motor (matchIntent nao e null) e o exemplo tambem', () => {
    const phraseLeaves = leaves(MENU_ROOT).filter((node) => node.action?.type === 'phrase');
    expect(phraseLeaves.length).toBeGreaterThan(10);
    for (const node of phraseLeaves) {
      if (node.action?.type !== 'phrase') continue;
      expect({ id: node.id, match: matchIntent(node.action.phrase) === null }).toEqual({ id: node.id, match: false });
      expect({ id: node.id, match: matchIntent(node.example ?? '') === null }).toEqual({ id: node.id, match: false });
    }
  });

  it('toda folha de instrucao tem texto e exemplo', () => {
    for (const node of leaves(MENU_ROOT).filter((item) => item.action?.type === 'instruction')) {
      expect(node.action).toMatchObject({ type: 'instruction' });
      expect(node.example).toBeTruthy();
    }
  });

  it('getMenuNode, listChildren e parentOf: pai para Voltar, raiz sem pai, id desconhecido vazio', () => {
    expect(getMenuNode('financas.despesa')?.title).toBe('🛒 Lançar despesa');
    expect(getMenuNode('nao.existe')).toBeUndefined();
    expect(listChildren('nao.existe')).toEqual([]);
    expect(listChildren('financas.despesa')).toEqual([]);
    expect(parentOf('financas.despesa')).toBe('financas');
    expect(parentOf('financas')).toBe(MENU_ROOT_ID);
    expect(parentOf(MENU_ROOT_ID)).toBeUndefined();
  });
});

describe('validateMenuTree (mutantes da arvore)', () => {
  const base = (): MenuNode => clone(MENU_ROOT);

  it('acusa id repetido', () => {
    const tree = base();
    tree.children![1].children![0].id = 'inicio.saldo';
    expect(validateMenuTree(tree).join('|')).toContain('id repetido: inicio.saldo');
  });

  it('acusa id com caractere fora do formato', () => {
    const tree = base();
    tree.children![0].children![0].id = 'Inicio Saldo';
    expect(validateMenuTree(tree).some((error) => error.startsWith('id invalido'))).toBe(true);
  });

  it('acusa id acima de 40 caracteres', () => {
    const tree = base();
    tree.children![0].children![0].id = 'a'.repeat(41);
    expect(validateMenuTree(tree).some((error) => error.startsWith('id invalido'))).toBe(true);
  });

  it('acusa grupo com acao e folha sem acao', () => {
    const grupo = base();
    grupo.children![0].action = { type: 'phrase', phrase: 'saldo' };
    expect(validateMenuTree(grupo).join('|')).toContain('grupo com acao: inicio');

    const folha = base();
    delete folha.children![0].children![0].action;
    expect(validateMenuTree(folha).join('|')).toContain('folha sem acao: inicio.saldo');
  });

  it('acusa folha sem exemplo e acao com texto vazio', () => {
    const semExemplo = base();
    delete semExemplo.children![0].children![0].example;
    expect(validateMenuTree(semExemplo).join('|')).toContain('folha sem exemplo: inicio.saldo');

    const vazia = base();
    vazia.children![0].children![0].action = { type: 'phrase', phrase: '  ' };
    expect(validateMenuTree(vazia).join('|')).toContain('frase vazia: inicio.saldo');
  });

  it('acusa ciclo', () => {
    const tree = base();
    tree.children![0].children!.push(tree.children![0]);
    expect(validateMenuTree(tree).join('|')).toContain('ciclo');
  });
});
