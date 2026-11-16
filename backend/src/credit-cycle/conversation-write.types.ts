export interface CreditLimitExpectation {
  cycleStart: string;
  cycleEnd: string;
  previousCeilingCents: number | null;
  countAllPayments: boolean;
}

export interface CreditLimitWriteReceipt {
  id: string;
  ceilingCents: number;
  cycleStart: string;
  cycleEnd: string;
  refreshPending: boolean;
}

/** Snapshot diferente, conferido sob bloqueio e sem upsert. */
export class CreditLimitChangedError extends Error {
  constructor(readonly current: CreditLimitExpectation) {
    super('O ciclo ou o limite observado mudou.');
    this.name = 'CreditLimitChangedError';
  }
}

export class CreditLimitWriteUncertainError extends Error {
  constructor() {
    super('Resultado da alteração do limite desconhecido.');
    this.name = 'CreditLimitWriteUncertainError';
  }
}
