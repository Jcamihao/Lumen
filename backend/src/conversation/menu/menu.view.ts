import { MENU_ROOT_ID } from './menu.tree';
import { parentOf } from './menu.tree.queries';
import { MenuNode, MenuView } from './menu.types';

export const MENU_REPLIES = {
  nothingToCancel: 'Nada para cancelar.',
  navigationHint: 'Digite a frase entre aspas. "voltar" sobe um nível; "menu" volta ao início.',
};

function guideOf(child: MenuNode): string {
  return child.guide ? `${child.title}: ${child.guide}` : child.title;
}

/** Titulo do menu; so a raiz leva a saudacao ("Bom dia! Lumen · ..."). */
function titleLine(node: MenuNode, greeting?: string): string {
  return greeting && node.id === MENU_ROOT_ID ? `${greeting}! ${node.title}` : node.title;
}

/** Cabecalho com botoes: titulo e uma linha de guia por opcao. */
function menuHeader(node: MenuNode, greeting?: string): string {
  return [titleLine(node, greeting), ...(node.children ?? []).map(guideOf)].join('\n');
}

/** Forma do menu para o canal: opcoes, e Voltar/Menu quando nao e a raiz. */
export function menuViewOf(node: MenuNode, greeting?: string): MenuView {
  const isRoot = node.id === MENU_ROOT_ID;
  const parentId = parentOf(node.id);
  return {
    nodeId: node.id,
    title: menuHeader(node, greeting),
    options: (node.children ?? []).map((child) => ({ id: child.id, label: child.title })),
    ...(isRoot ? {} : { backId: parentId ?? MENU_ROOT_ID, topId: MENU_ROOT_ID }),
  };
}

/** Texto do menu para canal sem botao: lista numerada com o guia, e a frase para digitar nas folhas. */
export function menuText(node: MenuNode, greeting?: string): string {
  const lines = (node.children ?? []).map((child, index) => {
    const hint = child.example && !child.children ? ` — "${child.example}"` : '';
    return `${index + 1}. ${guideOf(child)}${hint}`;
  });
  return [titleLine(node, greeting), ...lines, MENU_REPLIES.navigationHint].join('\n');
}

/** Todo resultado obtido por botao termina com a frase de atalho da folha (contrato secao 3, item 6). */
export function withDica(text: string, example: string | undefined): string {
  return example ? `${text}\n\nDica: da próxima vez, é só dizer: ${example}` : text;
}
