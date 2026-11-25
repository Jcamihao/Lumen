import { MENU_ROOT, MENU_ROOT_ID } from './menu.tree';
import { MenuNode } from './menu.types';

const ID_PATTERN = /^[a-z0-9_:.-]{1,40}$/;
const CALLBACK_MAX_BYTES = 64;

interface IndexEntry {
  node: MenuNode;
  parentId: string | null;
}

/** Indice id -> no e pai, montado uma vez. Id repetido: vale a primeira ocorrencia (validateMenuTree acusa). */
function indexTree(root: MenuNode): Map<string, IndexEntry> {
  const index = new Map<string, IndexEntry>();
  const visit = (node: MenuNode, parentId: string | null): void => {
    if (!index.has(node.id)) index.set(node.id, { node, parentId });
    for (const child of node.children ?? []) visit(child, node.id);
  };
  visit(root, null);
  return index;
}

const INDEX = indexTree(MENU_ROOT);

/** No pelo id. Id desconhecido = undefined (quem chama decide o fallback). */
export function getMenuNode(id: string): MenuNode | undefined {
  return INDEX.get(id)?.node;
}

/** Filhos diretos do no; folha ou id desconhecido = lista vazia. */
export function listChildren(id: string): MenuNode[] {
  return getMenuNode(id)?.children ?? [];
}

/** Pai do no para o botao Voltar; raiz e id desconhecido = undefined. */
export function parentOf(id: string): string | undefined {
  return INDEX.get(id)?.parentId ?? undefined;
}

/** Erros da arvore (lista vazia = valida). Confere formato, tamanho, unicidade, grupo x folha e ciclo. */
export function validateMenuTree(root: MenuNode = MENU_ROOT): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const path = new Set<MenuNode>();

  const check = (node: MenuNode): void => {
    if (path.has(node)) {
      errors.push(`ciclo no no ${node.id}`);
      return;
    }
    if (!ID_PATTERN.test(node.id)) errors.push(`id invalido: ${node.id}`);
    if (Buffer.byteLength(node.id, 'utf8') > CALLBACK_MAX_BYTES) errors.push(`id acima de 64 bytes: ${node.id}`);
    if (seenIds.has(node.id)) errors.push(`id repetido: ${node.id}`);
    seenIds.add(node.id);
    if (node.title.trim() === '') errors.push(`titulo vazio: ${node.id}`);

    const isGroup = node.children !== undefined && node.children.length > 0;
    if (isGroup && node.action) errors.push(`grupo com acao: ${node.id}`);
    if (!isGroup && !node.action) errors.push(`folha sem acao: ${node.id}`);
    if (!isGroup && (!node.example || node.example.trim() === '')) errors.push(`folha sem exemplo: ${node.id}`);
    if (node.action?.type === 'phrase' && node.action.phrase.trim() === '') errors.push(`frase vazia: ${node.id}`);
    if (node.action?.type === 'instruction' && node.action.text.trim() === '') errors.push(`instrucao vazia: ${node.id}`);

    path.add(node);
    for (const child of node.children ?? []) check(child);
    path.delete(node);
  };

  check(root);
  if (root.id !== MENU_ROOT_ID) errors.push(`raiz com id diferente de ${MENU_ROOT_ID}`);
  return errors;
}
