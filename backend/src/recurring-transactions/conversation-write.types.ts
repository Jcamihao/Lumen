/** Regras extras do bot: primeiro vencimento não pode ser anterior a hoje. */
export interface ConversationWriteRules {
  notBefore: 'today';
}

/** Recibo da gravação feita pelo bot: só o que foi persistido e as flags do que veio depois do commit. */
export interface RecurringWriteReceipt {
  id: string;
  description: string;
  amountCents: number;
  frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  /** Primeiro vencimento 'AAAA-MM-DD', lido da linha gravada. */
  firstDueDate: string;
  /** Materialização dos vencimentos de hoje falhou: a tela precisa ser conferida. */
  materializationPending: boolean;
  /** Atualização dos dados derivados falhou. */
  refreshPending: boolean;
}

/** Limite de vencimento do bot: 2 anos a partir de hoje (mesma regra do núcleo). */
export const FIRST_DUE_MAX_YEARS = 2;

/** Último primeiro vencimento aceito, 'AAAA-MM-DD', a partir de `todayYmd`. */
export function firstDueLatestYmd(todayYmd: string): string {
  const [year, month, day] = todayYmd.split('-').map(Number);
  return new Date(Date.UTC(year + FIRST_DUE_MAX_YEARS, month - 1, day)).toISOString().slice(0, 10);
}

/** Nenhuma escrita ocorreu: o primeiro vencimento ficou no passado entre rascunho e confirmação. */
export class RecurringFirstDueChangedError extends Error {
  constructor(readonly today: string) {
    super('O primeiro vencimento ficou no passado.');
    this.name = 'RecurringFirstDueChangedError';
  }
}

/** O callback terminou, mas não foi possível confirmar o resultado do commit. */
export class RecurringWriteUncertainError extends Error {
  constructor() {
    super('Resultado da criação da conta fixa desconhecido.');
    this.name = 'RecurringWriteUncertainError';
  }
}
