import { AmountFailure, parseAmountPrefix } from './amount.parser';
import { normalize } from './normalize';

/** Nome de meta: 2 a 60 caracteres (contrato 3b1, secao 3). */
export const GOAL_TITLE_MIN = 2;
export const GOAL_TITLE_MAX = 60;

/** Palavras de ligação removidas do começo do nome no aporte (contrato 3b1, secao 3). */
const CONTRIBUTION_SKIP_WORDS = new Set([
  'na', 'no', 'em', 'para', 'pra', 'a', 'meta', 'cofrinho', 'reais', 'minha', 'meu', 'o', 'da', 'do', 'de',
]);

/** Conectores que sobram nas pontas do nome em "criar meta de viagem" / "viagem com 3 mil". */
const TITLE_EDGE_WORDS = new Set(['de', 'da', 'do', 'para', 'pra', 'com', 'em']);

/** Respostas que fecham a meta como cofrinho (sem alvo). Já normalizadas (sem acento, minúsculas). */
const NO_TARGET_ANSWERS = new Set(['sem alvo', 'nenhum', 'nao']);

export type CreateGoalParse =
  /** targetCents: undefined = falta perguntar o alvo; null = sem alvo (cofrinho). */
  | { ok: true; title: string | null; targetCents: number | null | undefined }
  | { ok: false; reason: AmountFailure };

export type ContributionParse =
  | { ok: true; amountCents: number | null; name: string | null }
  | { ok: false; reason: AmountFailure };

/**
 * Corpo de "criar meta" (contrato 3b1, secao 3):
 * 1. começa com valor: "3 mil viagem";
 * 2. termina com valor de 1 ou 2 palavras: "viagem 3 mil", "viagem 3000";
 * 3. só nome: "viagem" (pergunta o alvo); vazio: pergunta o nome.
 * Valor que tenta ser valor e falha (1,234, 0) devolve o motivo; quem chama responde com a correção.
 */
export function parseCreateGoalBody(body: string): CreateGoalParse {
  const tokens = splitWords(body);
  if (tokens.length === 0) {
    return { ok: true, title: null, targetCents: undefined };
  }

  const start = parseAmountPrefix(tokens.join(' '));
  if (start.ok === true) {
    return { ok: true, title: cleanTitle(start.rest), targetCents: start.cents };
  }
  if (start.ok === false && start.reason !== 'NOT_AMOUNT') {
    return { ok: false, reason: start.reason };
  }

  // Valor no fim: testa 2 palavras antes de 1 ("3 mil" antes de "mil"). Precisa sobrar nome.
  for (const size of [2, 1]) {
    if (tokens.length <= size) continue;
    const tail = parseAmountPrefix(tokens.slice(-size).join(' '));
    if (tail.ok === true && tail.rest === '') {
      return { ok: true, title: cleanTitle(tokens.slice(0, -size).join(' ')), targetCents: tail.cents };
    }
    if (tail.ok === false && tail.reason !== 'NOT_AMOUNT') {
      return { ok: false, reason: tail.reason };
    }
  }

  if (tokens.length > 2 && isNoTargetTail(tokens)) {
    return { ok: true, title: cleanTitle(tokens.slice(0, -2).join(' ')), targetCents: null };
  }
  return { ok: true, title: cleanTitle(tokens.join(' ')), targetCents: undefined };
}

/**
 * Corpo de "criar cofrinho": cofrinho é meta sem alvo, então o corpo inteiro é o nome
 * ("viagem de 2027" não vira alvo de R$ 2.027). "sem alvo" no fim é redundante e sai.
 */
export function parseCofrinhoBody(body: string): string | null {
  const tokens = splitWords(body);
  if (tokens.length > 2 && isNoTargetTail(tokens)) {
    return cleanTitle(tokens.slice(0, -2).join(' '));
  }
  return cleanTitle(tokens.join(' '));
}

/**
 * Corpo de "guardar/aportar/...": valor opcional no começo, depois palavras de ligação e o nome.
 * "guardar 200 na viagem" -> valor 200, nome "viagem". "guardar viagem" -> sem valor.
 */
export function parseContributionBody(body: string): ContributionParse {
  const start = parseAmountPrefix(body.trim());
  let rest = body;
  let amountCents: number | null = null;
  if (start.ok === true) {
    amountCents = start.cents;
    rest = start.rest;
  } else if (start.ok === false && start.reason !== 'NOT_AMOUNT') {
    return { ok: false, reason: start.reason };
  }

  const words = splitWords(rest);
  while (words.length > 0 && CONTRIBUTION_SKIP_WORDS.has(normalize(words[0]))) {
    words.shift();
  }
  return { ok: true, amountCents, name: words.length > 0 ? words.join(' ') : null };
}

/**
 * Valor no fim do nome do aporte ("viagem 200", "viagem 1,5 mil"): só o motor usa, e só quando o nome
 * inteiro não casou com nenhuma meta (uma meta "Viagem 2027" tem prioridade sobre o valor).
 */
export function splitTrailingAmount(name: string): ContributionParse | null {
  const tokens = splitWords(name);
  for (const size of [2, 1]) {
    if (tokens.length <= size) continue;
    const tail = parseAmountPrefix(tokens.slice(-size).join(' '));
    if (tail.ok === true && tail.rest === '') {
      return { ok: true, amountCents: tail.cents, name: cleanTitle(tokens.slice(0, -size).join(' ')) };
    }
    if (tail.ok === false && tail.reason !== 'NOT_AMOUNT') {
      return { ok: false, reason: tail.reason };
    }
  }
  return null;
}

/** Resposta à pergunta de alvo que fecha como cofrinho. */
export function isNoTargetAnswer(text: string): boolean {
  return NO_TARGET_ANSWERS.has(normalize(text));
}

function isNoTargetTail(tokens: string[]): boolean {
  const tail = tokens.slice(-2).map((token) => normalize(token));
  return tail[0] === 'sem' && tail[1] === 'alvo';
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

function textOrNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Nome sem conectores soltos nas pontas ("de viagem", "viagem com"). Só conectores = sem nome. */
function cleanTitle(text: string): string | null {
  const words = splitWords(text);
  while (words.length > 0 && TITLE_EDGE_WORDS.has(normalize(words[0]))) words.shift();
  while (words.length > 0 && TITLE_EDGE_WORDS.has(normalize(words[words.length - 1]))) words.pop();
  return textOrNull(words.join(' '));
}
