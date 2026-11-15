import { PaymentMethod, TransactionType } from '@prisma/client';

const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata centavos inteiros como R$ 1.234,56. */
export function formatBrl(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

export const REPLIES = {
  help:
    'Exemplos: "50 mercado" (gasto), "recebi 800 de freelance" (receita), "saldo", "resumo", ' +
    '"quanto gastei", "gastos com mercado", "limite do cartão".',
  unrecognized: 'Não entendi. Digite "ajuda" para ver os exemplos.',
  duplicate: 'Essa mensagem já foi processada. Nada foi alterado.',
  expired: 'O rascunho expirou e foi descartado. Envie o lançamento de novo.',
  cancelled: 'Rascunho cancelado. Nada foi gravado.',
  confirmReminder: 'Há um rascunho aguardando. Responda "confirmar" ou "cancelar".',
  collectingReminder: 'Há um rascunho em andamento. Responda a pergunta ou "cancelar".',
  saveFailed: 'Não consegui gravar o lançamento. O rascunho foi mantido; tente confirmar de novo.',
  saveFailedRestoreLost:
    'Não consegui gravar o lançamento e outro rascunho já foi aberto. Envie o lançamento de novo.',
  invalidDate: 'Data inválida. Use hoje, ontem, dd/mm ou dd/mm/aaaa.',
  amountZero: 'O valor precisa ser maior que zero.',
  amountNegative: 'Envie o valor sem sinal de menos.',
  amountTooLarge: 'O valor passa do limite de 1.000.000,00.',
  amountAmbiguous:
    'Valor ambíguo. Escreva com centavos (1234,00 ou 1.234,00) ou sem separador (1234).',
  amountMissing: 'Não encontrei o valor. Ex.: "50 mercado".',
  descriptionTooLong: 'A descrição passa de 120 caracteres.',
  askAmount: 'Quanto foi? Responda só o valor. Ex.: 50 ou 32,90.',
  askDescription: 'Qual a descrição do lançamento? Ex.: mercado.',
  askCategoryNoOptions: 'Qual a categoria? Responda o nome ou "sem categoria".',
  noCeiling: 'Não há limite definido neste ciclo do cartão.',
  futureDate: 'A data é futura. Confira antes de confirmar.',
  noCategoryMatch: (query: string) => `Não encontrei a categoria "${query}" neste mês.`,
};

export function typeLabel(type: TransactionType): string {
  return type === TransactionType.INCOME ? 'receita' : 'gasto';
}

export function paymentLabel(method: PaymentMethod | null): string {
  if (method === PaymentMethod.PIX) return 'PIX';
  if (method === PaymentMethod.CREDIT) return 'crédito';
  if (method === PaymentMethod.DEBIT) return 'débito';
  return 'não informado';
}

export function balanceText(balanceCents: number): string {
  return `Saldo atual: ${formatBrl(balanceCents)}.`;
}

export function monthSummaryText(incomeCents: number, expenseCents: number, balanceCents: number): string {
  return [
    'Resumo do mês:',
    `Entradas: ${formatBrl(incomeCents)}`,
    `Saídas: ${formatBrl(expenseCents)}`,
    `Saldo atual: ${formatBrl(balanceCents)}`,
  ].join('\n');
}

export function spendTotalText(expenseCents: number): string {
  return `Gastos do mês: ${formatBrl(expenseCents)}.`;
}

export function categoryTotalText(name: string, cents: number): string {
  return `Gastos com ${name} no mês: ${formatBrl(cents)}.`;
}

export function cardText(input: {
  ceilingCents: number | null;
  spentCents: number;
  remainingCents: number | null;
  closingDay: number;
  dueDay: number | null;
}): string {
  if (input.ceilingCents === null) {
    return REPLIES.noCeiling;
  }
  const due = input.dueDay ? `, vencimento dia ${input.dueDay}` : '';
  return [
    `Limite do ciclo: ${formatBrl(input.ceilingCents)}.`,
    `Usado: ${formatBrl(input.spentCents)}.`,
    `Disponível: ${formatBrl(input.remainingCents ?? 0)}.`,
    `Fechamento dia ${input.closingDay}${due}.`,
  ].join('\n');
}

export function draftText(input: {
  type: TransactionType;
  amountCents: number;
  description: string;
  category: string | null;
  date: string;
  paymentMethod: PaymentMethod | null;
  futureDate: boolean;
}): string {
  const lines = [
    `Rascunho de ${typeLabel(input.type)}:`,
    `Valor: ${formatBrl(input.amountCents)}`,
    `Descrição: ${input.description}`,
    `Categoria: ${input.category ?? 'sem categoria'}`,
    `Data: ${input.date}`,
    `Pagamento: ${paymentLabel(input.paymentMethod)}`,
  ];
  if (input.futureDate) {
    lines.push(REPLIES.futureDate);
  }
  lines.push('Responda "confirmar" ou "cancelar".');
  return lines.join('\n');
}

export function doneText(type: TransactionType, amountCents: number, description: string): string {
  return `Registrado: ${typeLabel(type)} de ${formatBrl(amountCents)} (${description}).`;
}

export function categoryOptionsText(names: string[]): string {
  return `Qual a categoria? ${names.map((name, index) => `${index + 1}) ${name}`).join(' ')} ou "sem categoria".`;
}
