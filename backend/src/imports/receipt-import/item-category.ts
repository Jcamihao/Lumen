import { normalizeText } from './text-helpers';

type CategoryRule = { label: string; keywords: string[] };

const CATEGORY_RULES: CategoryRule[] = [
  { label: 'Alimentacao', keywords: ['arroz', 'feij', 'macarrao', 'carne', 'frango', 'queijo', 'pao', 'biscoito', 'iogurte', 'cafe', 'acucar', 'farinha'] },
  { label: 'Bebidas', keywords: ['agua', 'refrigerante', 'suco', 'cerveja', 'vinho', 'energetico', 'cha', 'bebida'] },
  { label: 'Hortifruti', keywords: ['banana', 'maca', 'laranja', 'tomate', 'cebola', 'batata', 'alface', 'fruta', 'legume', 'verdura', 'horti'] },
  { label: 'Limpeza', keywords: ['detergente', 'desinfetante', 'amaciante', 'sabao', 'multiuso', 'agua sanitaria', 'esponja', 'limpeza'] },
  { label: 'Higiene', keywords: ['shampoo', 'sabonete', 'creme dental', 'pasta dental', 'desodorante', 'absorvente', 'papel higienico', 'escova dental'] },
  { label: 'Farmacia', keywords: ['paracetamol', 'dipirona', 'ibuprofeno', 'medic', 'remedio', 'vitamina', 'farmacia'] },
  { label: 'Pet', keywords: ['racao', 'petisco pet', 'areia gato', 'pet'] },
  { label: 'Bebes', keywords: ['fralda', 'lenco umedecido', 'formula infantil', 'mamadeira', 'bebe'] },
  { label: 'Casa', keywords: ['lampada', 'pilha', 'panela', 'utensilio', 'toalha', 'tapete', 'casa'] },
  { label: 'Eletronicos', keywords: ['fone', 'cabo', 'mouse', 'teclado', 'carregador', 'eletron'] },
  { label: 'Vestuario', keywords: ['camiseta', 'calca', 'blusa', 'tenis', 'meia', 'vest'] },
];

const HINT_ALIASES: Record<string, string[]> = {
  Alimentacao: ['aliment', 'mercearia', 'comida'],
  Bebidas: ['bebida'],
  Hortifruti: ['hortifruti', 'horti', 'fruta', 'verdura', 'legume', 'feira'],
  Limpeza: ['limpeza'],
  Higiene: ['higiene', 'beleza'],
  Farmacia: ['farm', 'saud', 'medic'],
  Pet: ['pet', 'animal'],
  Bebes: ['bebe', 'infantil'],
  Casa: ['casa', 'lar', 'utilidade'],
  Eletronicos: ['eletron', 'tecnolog', 'informat'],
  Vestuario: ['vest', 'roupa', 'moda'],
  Servicos: ['servico'],
};

export function normalizeProductHint(value: string | null): string | null {
  const normalized = normalizeText(value || '');
  if (!normalized) return null;
  const entry = Object.entries(HINT_ALIASES).find(([, keywords]) =>
    keywords.some((keyword) => normalized.includes(keyword)),
  );
  return entry?.[0] || null;
}

/** Categoria do item pela dica (se houver) ou por palavra-chave da descricao. */
export function inferReceiptItemCategory(description: string, aiHint: string | null): string | null {
  const normalizedHint = normalizeProductHint(aiHint);
  if (normalizedHint) return normalizedHint;
  const normalized = normalizeText(description);
  const match = CATEGORY_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));
  return match?.label || null;
}
