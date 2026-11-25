import { parseAmountPrefix } from './amount.parser';
import { normalizeWord } from './normalize';

/** Intencoes que o reconhecimento natural pode devolver. O matcher principal converte para IntentMatch. */
export interface NaturalWrite {
  intent: 'create_expense' | 'create_income' | 'contribute_goal' | 'create_installment';
  body: string;
}

/** Frases com verbo informal no comeco: valem so com valor logo depois (ate 1 palavra de enchimento) e sem "?". */
const INFORMAL_VERBS: Array<{ intent: 'create_expense' | 'create_income' | 'contribute_goal'; verbs: string[][] }> = [
  { intent: 'create_expense', verbs: [['foi'], ['saiu'], ['torrei'], ['passei']] },
  { intent: 'create_income', verbs: [['caiu'], ['entrou'], ['me', 'pagaram']] },
  { intent: 'contribute_goal', verbs: [['guardei'], ['coloquei'], ['juntei'], ['depositei'], ['separei'], ['poupei']] },
];

/** Verbos de parcelado: a frase precisa de "em <N>x de <valor>" (valor da parcela). */
const INSTALLMENT_VERBS: string[][] = [['comprei'], ['parcelei']];

/** Verbos ambiguos ("coloquei 200 no bolso"): so valem como aporte se a frase cita caixinha, cofrinho ou meta. */
const GOAL_KEYWORD_VERBS = new Set(['coloquei', 'depositei', 'separei']);
const GOAL_KEYWORDS = new Set(['caixinha', 'caixinhas', 'cofrinho', 'cofrinhos', 'meta', 'metas']);

const FILLER_WORDS = new Set(['so', 'ja', 'ai', 'uns', 'cerca', 'exatos', 'mais']);
const ARTICLE_WORDS = new Set(['um', 'uma', 'o', 'a', 'meu', 'minha', 'uns', 'umas']);
/** Palavras de ligacao que nao contam como destino de aporte ("guardei 200 na" nao diz para onde). */
const CONNECTOR_WORDS = new Set(['na', 'no', 'em', 'para', 'pra', 'pro', 'a', 'o', 'da', 'do', 'de', 'minha', 'meu', 'um', 'uma', 'ao']);

/** Mesmo limite dos comandos de escrita novos (intent.matcher.ts): ate 20 palavras e 500 caracteres. */
/** Palavra logo depois do numero que mostra contagem ou medida, nao dinheiro ("passei 2 vezes", "entrou 2 pessoas"). */
const COUNT_WORDS = new Set([
  'vez', 'vezes', 'pessoa', 'pessoas', 'gente', 'amigo', 'amigos', 'litro', 'litros', 'quilo', 'quilos', 'kg', 'km',
  'metro', 'metros', 'hora', 'horas', 'minuto', 'minutos', 'segundo', 'segundos', 'dias', 'semana', 'semanas',
  'mes', 'meses', 'ano', 'anos', 'unidade', 'unidades', 'pedaco', 'pedacos', 'caixa', 'caixas', 'item', 'itens',
]);

/** Sobra aceita depois do valor da parcela ("em 10x de 150 reais"). */
const CURRENCY_WORDS = new Set(['', 'reais', 'real']);

const NATURAL_MAX_WORDS = 20;
const NATURAL_MAX_CHARS = 500;

/** Reconhece escrita em linguagem natural (contrato 12.0b, secao 2). Devolve null quando a frase nao e escrita. */
export function matchNaturalWrite(raw: string, tokens: string[], words: string[]): NaturalWrite | null {
  if (raw.length > NATURAL_MAX_CHARS || tokens.length > NATURAL_MAX_WORDS || raw.includes('?')) {
    return null;
  }
  return matchInstallment(tokens, words) ?? matchInformal(tokens, words);
}

function matchInformal(tokens: string[], words: string[]): NaturalWrite | null {
  for (const { intent, verbs } of INFORMAL_VERBS) {
    const verb = verbs.find((candidate) => startsWithWords(words, candidate));
    if (verb === undefined) continue;
    const write = informalWrite(intent, tokens.slice(verb.length), words.slice(verb.length));
    if (write !== null && GOAL_KEYWORD_VERBS.has(verb[0]) && !words.some((word) => GOAL_KEYWORDS.has(word))) return null;
    return write;
  }
  return null;
}

function informalWrite(
  intent: 'create_expense' | 'create_income' | 'contribute_goal',
  tokens: string[],
  words: string[],
): NaturalWrite | null {
  const amountTokens = FILLER_WORDS.has(words[0] ?? '') ? tokens.slice(1) : tokens;
  const body = amountTokens.join(' ');
  const amount = parseAmountPrefix(body);
  if (amount.ok === true && COUNT_WORDS.has(normalizeWord(firstWord(amount.rest)))) return null;
  if (intent !== 'contribute_goal') {
    return amount.ok === true || amount.reason !== 'NOT_AMOUNT' ? { intent, body } : null;
  }
  return amount.ok === true && hasDestination(amount.rest) ? { intent, body } : null;
}

/** "comprei um celular em 10x de 150": o valor depois de "de" e da parcela; o total vai para o parcelado existente. */
function matchInstallment(tokens: string[], words: string[]): NaturalWrite | null {
  const verb = INSTALLMENT_VERBS.find((candidate) => startsWithWords(words, candidate));
  if (verb === undefined) return null;
  const rest = words.slice(verb.length);
  const emAt = rest.findIndex((word, index) => word === 'em' && /^\d+x$/.test(rest[index + 1] ?? ''));
  if (emAt === -1 || rest[emAt + 2] !== 'de') return null;

  const description = dropArticles(tokens.slice(verb.length, verb.length + emAt)).join(' ');
  const parcel = parseAmountPrefix(tokens.slice(verb.length + emAt + 3).join(' '));
  if (description === '' || parcel.ok !== true || !CURRENCY_WORDS.has(normalizeWord(parcel.rest))) return null;

  const quantity = rest[emAt + 1];
  const total = parcel.cents * Number(quantity.slice(0, -1));
  return { intent: 'create_installment', body: `${formatCents(total)} ${description} em ${quantity}` };
}

function firstWord(text: string): string {
  return text.trim().split(/\s+/)[0] ?? '';
}

/** O destino do aporte vem depois de uma palavra de ligacao ("na viagem") e diz algo alem dela. */
function hasDestination(rest: string): boolean {
  const afterCurrency = rest.replace(/^\s*(reais|real)\b/i, '');
  if (!CONNECTOR_WORDS.has(normalizeWord(firstWord(afterCurrency)))) return false;
  return afterCurrency.split(/\s+/).some((word) => word.length > 0 && !CONNECTOR_WORDS.has(normalizeWord(word)));
}

function dropArticles(tokens: string[]): string[] {
  let start = 0;
  while (start < tokens.length && ARTICLE_WORDS.has(normalizeWord(tokens[start]))) start += 1;
  return tokens.slice(start);
}

function startsWithWords(words: string[], prefix: string[]): boolean {
  return prefix.every((word, index) => words[index] === word);
}

/** Centavos inteiros para o texto que o parser de valor le ("1500,00"). */
function formatCents(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}
