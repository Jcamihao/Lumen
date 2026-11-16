import { splitInstallments } from './conversation-write.types';

describe('splitInstallments (divisão em centavos do parcelado)', () => {
  it.each([
    // [total em centavos, parcelas, parcela comum, última]
    [1000, 3, 333, 334], // R$ 10,00 em 3
    [10000, 3, 3333, 3334], // R$ 100,00 em 3
    [120000, 12, 10000, 10000], // R$ 1.200,00 em 12
    [3335, 7, 476, 479], // R$ 33,35 em 7
    [2, 2, 1, 1], // R$ 0,02 em 2
    [3, 2, 2, 1], // R$ 0,03 em 2: a última fica menor
    [60, 60, 1, 1], // R$ 0,60 em 60
    [61, 60, 1, 2], // R$ 0,61 em 60: a última absorve a sobra
    [9_999_999_999, 60, 166_666_667, 166_666_646], // R$ 99.999.999,99 em 60
  ])('%i centavos em %i parcelas: comum %i e última %i', (total, count, common, last) => {
    expect(splitInstallments(total, count)).toEqual({ installmentCents: common, lastInstallmentCents: last });
  });

  it.each([
    [1, 2], // R$ 0,01 em 2: a comum arredonda para 1, a última ficaria zero
    [1, 3], // a comum arredonda para 0 (parcela de R$ 0,00), a última teria R$ 0,01
    [2, 60], // a comum arredonda para 0 e a última absorveria tudo
    [100, 60], // R$ 1,00 em 60: comum de R$ 0,02 e última negativa
    [59, 60], // última zero ou negativa
  ])('%i centavos em %i parcelas é recusado (alguma parcela ficaria abaixo de R$ 0,01)', (total, count) => {
    expect(splitInstallments(total, count)).toBeNull();
  });

  it('propriedade: aceito => todas as parcelas >= 1 centavo e soma exata; recusado => alguma parcela < 1 centavo', () => {
    const totals = [1, 2, 3, 5, 59, 60, 61, 99, 100, 101, 119, 120, 121, 999, 1000, 3335, 99_999, 100_000, 123_457, 9_999_999_999];
    for (const total of totals) {
      for (let count = 2; count <= 60; count += 1) {
        const split = splitInstallments(total, count);
        const common = Math.round(total / count);
        const last = total - common * (count - 1);
        if (split === null) {
          expect(common < 1 || last < 1).toBe(true);
        } else {
          expect(split.installmentCents).toBeGreaterThanOrEqual(1);
          expect(split.lastInstallmentCents).toBeGreaterThanOrEqual(1);
          expect(split.installmentCents * (count - 1) + split.lastInstallmentCents).toBe(total);
        }
      }
    }
  });
});
