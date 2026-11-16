export interface EnvelopeWriteReceipt {
  id: string;
  name: string;
  monthlyCents: number;
  provisionMonth: string;
  refreshPending: boolean;
}

/** Nenhuma escrita ocorreu: o mês mostrado precisa de novo aceite. */
export class EnvelopeMonthChangedError extends Error {
  constructor(readonly provisionMonth: string) {
    super('O mês da provisão mudou.');
    this.name = 'EnvelopeMonthChangedError';
  }
}

/** O callback terminou, mas não foi possível confirmar o resultado do commit. */
export class EnvelopeWriteUncertainError extends Error {
  constructor() {
    super('Resultado da criação da reserva desconhecido.');
    this.name = 'EnvelopeWriteUncertainError';
  }
}
