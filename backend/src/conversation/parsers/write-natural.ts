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

const FILLER_WORDS = new Set(['so', 'ja', 'ai', 'uns', 'cerca', 'exatos', 'mais']);
const ARTICLE_WORDS = new Set(['um', 'uma', 'o', 'a', 'meu', 'minha', 'uns', 'umas']);
/** Palavras de ligacao que nao contam como destino de aporte ("guardei 200 na" nao diz para onde). */
const CONNECTOR_WORDS = new Set(['na', 'no', 'em', 'para', 'pra', 'pro', 'a', 'o', 'da', 'do', 'de', 'minha', 'meu', 'um', 'uma', 'ao']);

/** Mesmo limite dos comandos de escrita novos (intent.matcher.ts): ate 20 palavras e 500 caracteres. */
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
    return informalWrite(intent, tokens.slice(verb.length), words.slice(verb.length));
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
  if (description === '' || parcel.ok !== true || parcel.rest !== '') return null;

  const quantity = rest[emAt + 1];
  const total = parcel.cents * Number(quantity.slice(0, -1));
  return { intent: 'create_installment', body: `${formatCents(total)} ${description} em ${quantity}` };
}

function hasDestination(rest: string): boolean {
  return rest.split(/\s+/).some((word) => word.length > 0 && !CONNECTOR_WORDS.has(normalizeWord(word)));
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
