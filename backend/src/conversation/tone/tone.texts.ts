/**
 * Textos fixos do tom (contrato 12.0b, secao 3). Sem IA: so frases prontas.
 * Placeholders: {valor}, {descricao}, {cartao}, {meta}, {total}, {parcelas}. Sao so dados ja validados do rascunho.
 * ALEGRE e CELEBRANDO podem ter 1 emoji. NEUTRO e ATENTO nunca tem emoji nem tom festivo.
 */

export type ToneKind = 'ALEGRE' | 'CELEBRANDO' | 'NEUTRO' | 'ATENTO';
export type ToneMoment = 'rascunho' | 'recibo';

export const TONE_TEXTS: Record<ToneKind, Record<ToneMoment, readonly string[]>> = {
  ALEGRE: {
    rascunho: [
      'Que boa! Entrou {valor} de {descricao} 🎉',
      'Show! Anotei {valor} de {descricao} como receita 🎉',
      'Boa! Vou registrar {valor} de {descricao} 🎉',
    ],
    recibo: [
      'Feito! Entrou {valor} de {descricao} 🎉',
      'Registrado! Entrada de {valor} de {descricao} 🎉',
      'Que boa! {valor} de {descricao} registrados 🎉',
    ],
  },
  CELEBRANDO: {
    rascunho: ['Boa! {valor} pra {meta} 💪', 'Ótimo! Vou guardar {valor} em {meta} 💪', 'Show! {valor} entrando em {meta} 💪'],
    recibo: ['Guardado! {valor} em {meta} 💪', 'Mais um passo: {valor} em {meta} 💪', 'Feito! {valor} em {meta} 💪'],
  },
  NEUTRO: {
    rascunho: ['Anotei: {valor}, {descricao}.', 'Entendi: {valor}, {descricao}.', 'Confira: {valor}, {descricao}.'],
    recibo: ['Anotado: {valor}, {descricao}{cartao}.', 'Pronto, anotei {valor}, {descricao}{cartao}.', 'Registrado: {valor}, {descricao}{cartao}.'],
  },
  ATENTO: {
    rascunho: [
      'Entendi: {descricao} em {parcelas}x, total {total}.',
      'Certo, compra parcelada: {descricao} em {parcelas}x, total {total}.',
      'Confira: {descricao} em {parcelas} parcelas, total {total}.',
    ],
    recibo: [
      'Parcelamento anotado: {descricao}, {parcelas}x, total {total}.',
      'Pronto: {descricao} em {parcelas}x, total {total}, registrado.',
      'Compra parcelada registrada: {descricao}, {parcelas}x, total {total}.',
    ],
  },
};

/** Radicais sem acento e em minusculas. Uma palavra sensivel (inicio de palavra) forca o tom NEUTRO. */
export const SENSITIVE_STEMS: readonly string[] = [
  'saude', 'hospit', 'remedi', 'medic', 'exame', 'doenc', 'funer', 'velori', 'enterr', 'luto',
  'divid', 'multa', 'cobranc', 'dentist', 'internac', 'cirurg',
];
