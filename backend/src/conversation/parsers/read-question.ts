import type { IntentMatch, ReadIntent } from './intent.matcher';
import { normalizeWord } from './normalize';
import { cleanCardTerm } from '../credit-limit';

/** Pergunta ou pedido de leitura em linguagem natural: acima disso e conversa livre (Selah). */
const READ_QUESTION_MAX_WORDS = 12;

/** Forma sem a palavra cartao so vale com ate esse numero de palavras no nome (evita pergunta longa). */
export const CARD_LOOSE_MAX_WORDS = 4;

/** Palavras que nao mudam o pedido: pergunta, cortesia, artigo, preposicao, possessivo, verbo auxiliar, tempo. */
const FILLER_WORDS = new Set([
  'como', 'qual', 'quais', 'quanto', 'quanta', 'quantos', 'quantas', 'quando', 'que', 'me', 'mostra', 'mostrar',
  'mostre', 'diz', 'dizer', 'fala', 'falar', 'ver', 'quero', 'queria', 'gostaria', 'saber', 'pode', 'poderia',
  'consegue', 'olhada', 'confere', 'conferir', 'consulta', 'consultar', 'vamos', 'favor', 'oi', 'ola', 'bot',
  'lumen', 'eu',
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'meu', 'minha', 'meus', 'minhas', 'de', 'do', 'da', 'dos',
  'das', 'no', 'na', 'nos', 'nas', 'em', 'pra', 'pras', 'para', 'pro', 'por', 'ai', 'la', 'ja', 'alguma', 'algum',
  'e', 'estou', 'esta', 'estao', 'eh', 'ta', 'to', 'foi', 'sao', 'vai',
  'hoje', 'agora', 'atual', 'atualmente', 'ate', 'este', 'esse', 'desse', 'deste', 'neste', 'nesse', 'essa',
  'nessa', 'semana',
]);

type CoreIntent = ReadIntent | 'credit_card';

/** Nucleos: o que sobra depois de tirar o enchimento, na ordem. Qualquer outra palavra = nao casa. */
const READ_CORES: Array<{ intent: CoreIntent; cores: string[] }> = [
  {
    intent: 'balance',
    cores: [
      'saldo', 'saldo disponivel', 'com saldo', 'disponivel', 'tenho', 'tem', 'com', 'tenho saldo', 'tenho dinheiro',
      'dinheiro', 'dinheiro tenho', 'tenho conta', 'tem conta', 'sobrou', 'sobrou mes',
    ],
  },
  { intent: 'month_summary', cores: ['mes', 'financas', 'financeiramente', 'resumo', 'resumo mes', 'resumo financeiro'] },
  {
    intent: 'spend_total',
    cores: [
      'gastei', 'gastando', 'gasto', 'gastos', 'gastei mes', 'gastando mes', 'gasto mes', 'gastos mes',
      'gastei total', 'gasto total', 'total gasto', 'total gastos',
    ],
  },
  {
    intent: 'upcoming_dues',
    cores: [
      'vence', 'vencer', 'vencem', 'vencimentos', 'proximos vencimentos', 'contas vencem', 'contas pagar',
      'tenho pagar', 'falta pagar', 'tenho conta pagar', 'tem conta vencendo', 'vence proxima conta',
    ],
  },
  {
    intent: 'installments',
    cores: [
      'parcelas', 'parcela', 'parcelados', 'tenho parcela', 'tenho parcelas', 'parcelas tenho',
      'compras parceladas', 'compras parceladas tenho',
    ],
  },
  {
    intent: 'fixed_bills',
    cores: ['contas fixas', 'despesas fixas', 'despesas fixas tenho', 'contas fixas tenho', 'pago conta fixa'],
  },
  { intent: 'goals', cores: ['metas', 'andam metas', 'falta metas'] },
  {
    intent: 'envelopes',
    cores: ['reservas', 'reserva', 'envelopes', 'guardado', 'tenho guardado', 'guardado tenho', 'tenho reserva'],
  },
  { intent: 'list_cards', cores: ['cartoes', 'cartoes tenho'] },
  {
    intent: 'credit_card',
    cores: [
      'cartao', 'limite', 'fatura', 'limite cartao', 'fatura cartao', 'devo cartao', 'gastei cartao',
      'sobrou cartao', 'limite tenho', 'tenho limite', 'tenho fatura', 'fatura tenho',
    ],
  },
];

const INTENT_BY_CORE = new Map<string, CoreIntent>(
  READ_CORES.flatMap(({ intent, cores }) => cores.map((core): [string, CoreIntent] => [core, intent])),
);

const KNOWN_WORDS = new Set([
  ...FILLER_WORDS,
  ...[...INTENT_BY_CORE.keys()].flatMap((core) => core.split(' ')),
]);

/** Cartao nomeado: palavras antes do cabecalho so podem ser pergunta ("como esta", "qual o", "quanto"). */
const CARD_LEAD_WORDS = new Set(['como', 'qual', 'quanto', 'esta', 'estao', 'o', 'a', 'meu', 'minha', 'e']);
const CARD_HEAD_WORDS = new Set(['cartao', 'fatura', 'limite', 'devo']);
const CARD_CONNECTORS = new Set(['do', 'da', 'no', 'na']);
/** Preposicao no fim da frase ("quanto sobrou no") e pedido incompleto: nao casa. */
const DANGLING_CONNECTORS = new Set(['no', 'na', 'do', 'da', 'de', 'em', 'com']);
/** Com "?", so pergunta que comeca com "como" ou "qual" vira leitura por cartao. */
const CARD_QUESTION_OPENERS = new Set(['como', 'qual']);

/**
 * Leitura em linguagem natural (pergunta ou pedido, com ou sem "?"). Devolve null se nada casou.
 * Chamada depois dos matchers de escrita e de leitura atuais: so pega o que sobrou.
 */
export function matchReadQuestion(raw: string, tokens: string[], words: string[]): IntentMatch | null {
  if (tokens.length === 0 || tokens.length > READ_QUESTION_MAX_WORDS) return null;
  if (tokens.some(hasDigit)) return null;
  const bareTokens = tokens.map((token) => token.replace(/[?!.,;:]+$/g, ''));
  return matchCoreReading(words) ?? matchCardQuestion(raw, bareTokens, words);
}

/** Verdade se o texto tem palavra de leitura ou enchimento (nao e nome de cartao). */
export function hasReadVocabulary(text: string): boolean {
  return text.split(/\s+/).some((word) => KNOWN_WORDS.has(normalizeWord(word)));
}

function matchCoreReading(words: string[]): IntentMatch | null {
  if (DANGLING_CONNECTORS.has(words[words.length - 1])) return null;
  const core = words.filter((word) => !FILLER_WORDS.has(word)).join(' ');
  const intent = INTENT_BY_CORE.get(core);
  return intent === undefined ? null : { intent };
}

/** "como esta a fatura do Nubank?", "qual o limite do Nubank", "quanto devo no Nubank", "como esta meu cartao Nubank". */
function matchCardQuestion(raw: string, tokens: string[], words: string[]): IntentMatch | null {
  const head = words.findIndex((word) => CARD_HEAD_WORDS.has(word));
  if (head === -1 || !words.slice(0, head).every((word) => CARD_LEAD_WORDS.has(word))) return null;
  if (raw.includes('?') && !CARD_QUESTION_OPENERS.has(words[0])) return null;
  const hasConnector = CARD_CONNECTORS.has(words[head + 1] ?? '');
  if (!hasConnector && words[head] !== 'cartao') return null;
  const start = head + (hasConnector ? 2 : 1);
  const named = words[start] === 'cartao' ? start + 1 : start;
  const explicit = words[head] === 'cartao' || named > start;
  const term = cleanCardTerm(tokens.slice(named).join(' '));
  if (term === '') return explicit ? { intent: 'credit_card' } : null;
  if (hasReadVocabulary(term)) return null;
  if (explicit) return { intent: 'credit_card', cardTerm: term };
  if (term.split(/\s+/).length > CARD_LOOSE_MAX_WORDS) return null;
  return { intent: 'credit_card', cardTerm: term, loose: true };
}

function hasDigit(token: string): boolean {
  return /\d/.test(token);
}
