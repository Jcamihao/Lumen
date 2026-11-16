import { parseInstallmentBody, parseRecurringBody, resolveFirstDue } from './write-body.parser';

const TODAY = '2026-11-15';

describe('parseRecurringBody', () => {
  it('valor, descrição, frequência e data no formato completo', () => {
    expect(parseRecurringBody('120 internet mensal primeiro 20/11/2026')).toEqual({
      ok: true,
      value: { description: 'internet', amountCents: 12000, frequency: 'MONTHLY', dueText: '20/11/2026' },
    });
  });

  it('sem frequência e sem data: frequência null (o motor usa mensal) e data null', () => {
    expect(parseRecurringBody('120 internet')).toMatchObject({ ok: true, value: { frequency: null, dueText: null } });
  });

  it('semanal e anual como sufixo', () => {
    expect(parseRecurringBody('120 internet semanal')).toMatchObject({ value: { frequency: 'WEEKLY', description: 'internet' } });
    expect(parseRecurringBody('120 internet anual')).toMatchObject({ value: { frequency: 'YEARLY', description: 'internet' } });
  });

  it('palavra coincidente no meio da descrição não é removida', () => {
    expect(parseRecurringBody('120 mensal de teste')).toMatchObject({ value: { description: 'mensal de teste', frequency: null } });
    expect(parseRecurringBody('120 seguro mensal de vida')).toMatchObject({ value: { description: 'seguro mensal de vida', frequency: null } });
  });

  it('"primeiro" seguido de palavra que não é data continua descrição', () => {
    expect(parseRecurringBody('120 primeiro curso de inglês')).toMatchObject({
      value: { description: 'primeiro curso de inglês', dueText: null },
    });
  });

  it('"primeiro" no fim sem data devolve dueText vazio (pergunta a data)', () => {
    expect(parseRecurringBody('120 internet primeiro')).toMatchObject({ value: { dueText: '' } });
  });

  it('"primeiro amanhã" e "primeiro dia 5" devolvem o texto da data para o motor recusar', () => {
    expect(parseRecurringBody('120 internet primeiro amanhã')).toMatchObject({ value: { dueText: 'amanhã' } });
    expect(parseRecurringBody('120 internet primeiro dia 5')).toMatchObject({ value: { dueText: 'dia 5' } });
  });

  it('sem valor no início: amountCents null e o corpo vira descrição', () => {
    expect(parseRecurringBody('internet mensal')).toMatchObject({ value: { amountCents: null, description: 'internet' } });
  });

  it('descrição de 1 caractere vira null (pergunta depois)', () => {
    expect(parseRecurringBody('120 a')).toMatchObject({ value: { description: null } });
  });

  it('valor inválido é recusado com o motivo do valor', () => {
    expect(parseRecurringBody('0 internet')).toEqual({ ok: false, reason: 'ZERO' });
    expect(parseRecurringBody('-5 internet')).toEqual({ ok: false, reason: 'NEGATIVE' });
    expect(parseRecurringBody('1,234 internet')).toEqual({ ok: false, reason: 'AMBIGUOUS' });
  });

  it('conectores no começo da descrição são tirados', () => {
    expect(parseRecurringBody('120 de internet')).toMatchObject({ value: { description: 'internet' } });
  });
});

describe('parseInstallmentBody', () => {
  it('total, descrição, quantidade e data', () => {
    expect(parseInstallmentBody('1200 geladeira em 12x primeiro 20/11/2026')).toEqual({
      ok: true,
      value: { description: 'geladeira', totalCents: 120000, installmentsTotal: 12, dueText: '20/11/2026' },
    });
  });

  it('"em 12" sem x também vale', () => {
    expect(parseInstallmentBody('1200 geladeira em 12')).toMatchObject({ value: { installmentsTotal: 12 } });
  });

  it('quantidade fora de 2 a 60 e fracionária recusam', () => {
    expect(parseInstallmentBody('1200 geladeira em 1x')).toEqual({ ok: false, reason: 'QUANTITY' });
    expect(parseInstallmentBody('1200 geladeira em 61x')).toEqual({ ok: false, reason: 'QUANTITY' });
    expect(parseInstallmentBody('1200 geladeira em 1,5x')).toEqual({ ok: false, reason: 'QUANTITY' });
  });

  it('"12x de 100" é recusado como total, não lido como R$ 100', () => {
    expect(parseInstallmentBody('12x de 100')).toEqual({ ok: false, reason: 'TOTAL_ONLY' });
  });

  it('"em" sem número no fim continua descrição', () => {
    expect(parseInstallmentBody('1200 geladeira em casa')).toMatchObject({
      value: { description: 'geladeira em casa', installmentsTotal: null },
    });
  });

  it('número no fim da descrição sem "em" não vira quantidade de parcelas', () => {
    expect(parseInstallmentBody('3500 notebook 2024')).toEqual({
      ok: true,
      value: { description: 'notebook 2024', totalCents: 350000, installmentsTotal: null, dueText: null },
    });
    expect(parseInstallmentBody('1200 geladeira 12')).toMatchObject({
      value: { description: 'geladeira 12', installmentsTotal: null },
    });
  });

  it('sem valor e sem quantidade: ambos null', () => {
    expect(parseInstallmentBody('geladeira')).toMatchObject({ value: { totalCents: null, installmentsTotal: null } });
  });
});

describe('resolveFirstDue', () => {
  it('hoje é a data de hoje', () => {
    expect(resolveFirstDue('hoje', TODAY)).toEqual({ kind: 'DATE', ymd: TODAY });
  });

  it('dd/mm usa o ano atual e aceita o dia 1 do mês', () => {
    expect(resolveFirstDue('1/12', TODAY)).toEqual({ kind: 'DATE', ymd: '2026-12-01' });
  });

  it('dd/mm no passado do ano atual é recusado, sem saltar para o ano seguinte', () => {
    expect(resolveFirstDue('14/11', TODAY)).toEqual({ kind: 'PAST' });
    expect(resolveFirstDue('01/01', TODAY)).toEqual({ kind: 'PAST' });
  });

  it('31/02 é inválida', () => {
    expect(resolveFirstDue('31/02/2027', TODAY)).toEqual({ kind: 'INVALID' });
    expect(resolveFirstDue('31/02', TODAY)).toEqual({ kind: 'INVALID' });
  });

  it('ano passado e data de mais de dois anos são recusados', () => {
    expect(resolveFirstDue('14/11/2026', TODAY)).toEqual({ kind: 'PAST' });
    expect(resolveFirstDue('15/11/2028', TODAY)).toEqual({ kind: 'DATE', ymd: '2028-11-15' });
    expect(resolveFirstDue('16/11/2028', TODAY)).toEqual({ kind: 'TOO_FAR' });
  });

  it('amanhã, dia 5, ISO e duas datas pedem data completa', () => {
    for (const text of ['amanhã', 'dia 5', '2026-11-20', '20/11 21/11']) {
      expect(resolveFirstDue(text, TODAY)).toEqual({ kind: 'UNSUPPORTED' });
    }
  });

  it('ontem é passada e recusada', () => {
    expect(resolveFirstDue('ontem', TODAY)).toEqual({ kind: 'PAST' });
  });
});
