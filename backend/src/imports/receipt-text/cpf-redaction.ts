import {
  CPF_ELEVEN_RE,
  CPF_LABEL_RE,
  CPF_MARK,
  CPF_OR_CONSUMER_RE,
  CPF_REMOVED,
  CPF_SHAPE_RE,
  CPF_TAIL_RE,
  ELEVEN_DIGITS_RE,
  KEEP_AFTER_LABEL_RE,
} from './cpf-patterns';

const LABEL_WINDOW = 30;

function realDigits(text: string): number {
  return (text.match(/[0-9]/g) ?? []).length;
}

/** CPF solto e, em linha de "CONSUMIDOR", 11 digitos sem pontuacao viram o marcador provisorio. */
function markLooseCpf(line: string): string {
  // A pontuacao do rotulo longo ("CPF/CNPJ do Consumidor:") nao pode sobrar pedaco.
  let out = line.replace(CPF_SHAPE_RE, (match) => (realDigits(match) >= 5 ? CPF_MARK : match));
  if (/CONSUMIDOR/i.test(out)) out = out.replace(ELEVEN_DIGITS_RE, CPF_MARK);
  return out;
}

/** Fim da area apagada depois do rotulo: ate 30 caracteres, parando antes de chave ou CNPJ formatado. */
function labelRemovalEnd(out: string, tailStart: number) {
  const keep = KEEP_AFTER_LABEL_RE.exec(out.slice(tailStart, tailStart + 400));
  const limit = keep ? Math.min(LABEL_WINDOW, keep.index) : LABEL_WINDOW;
  let end = Math.min(out.length, tailStart + limit);
  if (!keep && end === tailStart + LABEL_WINDOW) {
    // Se o 30o caractere cortou um CPF no meio, apaga o resto dele.
    const rest = CPF_TAIL_RE.exec(out.slice(end, end + 20));
    if (rest) end += rest[0].length;
  }
  // Cortou antes de chave/CNPJ: separa com espaco para o texto nao colar em "CPF removido".
  const glue = keep && limit === keep.index && end < out.length && out[end] !== ' ' ? ' ' : '';
  return { end, glue };
}

function redactAfterLabels(out: string): string {
  let result = '';
  let pos = 0;
  for (const label of out.matchAll(CPF_LABEL_RE)) {
    const start = label.index as number;
    if (start < pos) continue;
    const { end, glue } = labelRemovalEnd(out, start + label[0].length);
    result += out.slice(pos, start) + CPF_REMOVED + glue;
    pos = end;
  }
  return (result + out.slice(pos)).split(CPF_MARK).join(CPF_REMOVED);
}

function redactCpfLine(line: string): string {
  if (line.length < 3) return line;
  return redactAfterLabels(markLooseCpf(line));
}

function isBareCpfBelowLabel(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length <= 20 && CPF_ELEVEN_RE.test(trimmed) && realDigits(trimmed) >= 5;
}

/**
 * Remove CPF do texto. Cobre: CPF com pontuacao (inclusive espacos e O/l no lugar de digito), "CPF" mais
 * ate 30 caracteres da mesma linha (qualquer grafia: CPF, cpf, C.P.F.), e 11 digitos em linha sozinha
 * logo abaixo de uma linha com "CPF" ou "CONSUMIDOR". Nao altera chave de 44 digitos, CNPJ nem valores.
 */
export function redactCpf(text: string): string {
  if (typeof text !== 'string') return '';
  const lines = text.split('\n');
  const labelAbove = lines.map((line) => CPF_OR_CONSUMER_RE.test(line));
  return lines
    .map((line, i) => (i > 0 && labelAbove[i - 1] && isBareCpfBelowLabel(line) ? CPF_REMOVED : redactCpfLine(line)))
    .join('\n');
}
