/** Recibo da gravação feita pelo bot: só o que foi persistido e as flags do que veio depois do commit. */
export interface InstallmentWriteReceipt {
  id: string;
  description: string;
  totalCents: number;
  installmentsTotal: number;
  /** Valor de cada parcela comum, em centavos. */
  installmentCents: number;
  /** Valor da última parcela (absorve a sobra), em centavos. */
  lastInstallmentCents: number;
  /** Primeiro vencimento 'AAAA-MM-DD', lido da linha gravada. */
  firstDueDate: string;
  materializationPending: boolean;
  refreshPending: boolean;
}

/**
 * Divisão em centavos: parcela comum = total / n arredondado; última = sobra.
 * Null quando alguma parcela ficaria abaixo de R$ 0,01 (inclui última zero ou negativa).
 */
export function splitInstallments(totalCents: number, installmentsTotal: number): { installmentCents: number; lastInstallmentCents: number } | null {
  const installmentCents = Math.round(totalCents / installmentsTotal);
  const lastInstallmentCents = totalCents - installmentCents * (installmentsTotal - 1);
  if (installmentCents < 1 || lastInstallmentCents < 1) {
    return null;
  }
  return { installmentCents, lastInstallmentCents };
}

/** Nenhuma escrita ocorreu: o primeiro vencimento ficou no passado entre rascunho e confirmação. */
export class InstallmentFirstDueChangedError extends Error {
  constructor(readonly today: string) {
    super('O primeiro vencimento ficou no passado.');
    this.name = 'InstallmentFirstDueChangedError';
  }
}

/** O callback terminou, mas não foi possível confirmar o resultado do commit. */
export class InstallmentWriteUncertainError extends Error {
  constructor() {
    super('Resultado da criação da compra parcelada desconhecido.');
    this.name = 'InstallmentWriteUncertainError';
  }
}
