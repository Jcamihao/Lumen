import { PaymentMethod, TransactionType } from '@prisma/client';
import {
  contributionDoneText,
  contributionDraftText,
  doneText,
  draftText,
  formatBrl,
  installmentCreatedText,
  installmentDraftText,
} from './replies';

const EMOJI = /\p{Extended_Pictographic}/gu;
const CONFIRM = 'Responda "confirmar" ou "cancelar".';

function emojis(text: string): number {
  return (text.match(EMOJI) ?? []).length;
}

/** Sementes de messageId: cobre todas as variantes (3 por momento). */
const SEEDS = Array.from({ length: 60 }, (_, index) => `msg-${index}`);

function expenseDraft(seed: string, extra: Partial<Parameters<typeof draftText>[0]> = {}): string {
  return draftText({
    type: TransactionType.EXPENSE,
    amountCents: 5000,
    description: 'mercado',
    category: 'Alimentação',
    date: '2026-11-15',
    paymentMethod: PaymentMethod.PIX,
    futureDate: false,
    toneSeed: seed,
    ...extra,
  });
}

function incomeDraft(seed: string, extra: Partial<Parameters<typeof draftText>[0]> = {}): string {
  return draftText({
    type: TransactionType.INCOME,
    amountCents: 50000,
    description: 'freela',
    category: 'Trabalho',
    date: '2026-11-15',
    paymentMethod: null,
    futureDate: false,
    toneSeed: seed,
    ...extra,
  });
}

describe('rascunho de lancamento com tom', () => {
  it('despesa nunca tem emoji nem exclamacao, em nenhuma semente', () => {
    for (const seed of SEEDS) {
      const text = expenseDraft(seed);
      expect(emojis(text)).toBe(0);
      expect(text.split('\n')[0]).not.toContain('!');
    }
  });

  it('receita comemora com exatamente 1 emoji', () => {
    for (const seed of SEEDS) {
      expect(emojis(incomeDraft(seed).split('\n')[0])).toBe(1);
    }
  });

  it('mostra os dados que serao gravados e termina com a pergunta de confirmacao', () => {
    const text = expenseDraft('msg-1', { cardName: 'Nubank' });
    expect(text).toContain(`Valor: ${formatBrl(5000)}`);
    expect(text).toContain('Descrição: mercado');
    expect(text).toContain('Categoria: Alimentação');
    expect(text).toContain('Data: 2026-11-15');
    expect(text).toContain('Pagamento: PIX');
    expect(text).toContain('Cartão: Nubank');
    expect(text.endsWith(CONFIRM)).toBe(true);
  });

  it('mesmo messageId: mesma primeira linha', () => {
    expect(expenseDraft('msg-7')).toBe(expenseDraft('msg-7'));
  });

  it('distribuicao cobre as 3 variantes da despesa e da receita', () => {
    const expenseFirst = new Set(SEEDS.map((seed) => expenseDraft(seed).split('\n')[0]));
    const incomeFirst = new Set(SEEDS.map((seed) => incomeDraft(seed).split('\n')[0]));
    expect(expenseFirst.size).toBe(3);
    expect(incomeFirst.size).toBe(3);
  });

  it('palavra sensivel na descricao tira o emoji da receita', () => {
    for (const seed of SEEDS) {
      expect(emojis(incomeDraft(seed, { description: 'remédio' }).split('\n')[0])).toBe(0);
    }
  });

  it('palavra sensivel na categoria tira o emoji da receita', () => {
    for (const seed of SEEDS) {
      expect(emojis(incomeDraft(seed, { category: 'Dívidas' }).split('\n')[0])).toBe(0);
    }
  });
});

describe('recibo de lancamento com tom', () => {
  it('despesa: so confirma, sem emoji, com cartao quando houver', () => {
    for (const seed of SEEDS) {
      const text = doneText(TransactionType.EXPENSE, 5000, 'mercado', 'Nubank', { seed });
      expect(emojis(text)).toBe(0);
      expect(text).toContain(formatBrl(5000));
      expect(text).toContain('mercado');
      expect(text).toContain('no cartão Nubank');
    }
  });

  it('receita comemora com 1 emoji e sem cartao', () => {
    for (const seed of SEEDS) {
      const text = doneText(TransactionType.INCOME, 50000, 'freela', null, { seed });
      expect(emojis(text)).toBe(1);
      expect(text).not.toContain('cartão');
    }
  });

  it('recibo varia pela semente: despesa e receita cobrem as 3 variantes', () => {
    const expense = new Set(SEEDS.map((seed) => doneText(TransactionType.EXPENSE, 5000, 'mercado', null, { seed })));
    const income = new Set(SEEDS.map((seed) => doneText(TransactionType.INCOME, 5000, 'freela', null, { seed })));
    expect(expense.size).toBe(3);
    expect(income.size).toBe(3);
  });

  it('categoria sensivel no recibo de receita: neutro (mesmo tom do rascunho)', () => {
    for (const seed of SEEDS) {
      expect(emojis(doneText(TransactionType.INCOME, 50000, 'freela', null, { seed, category: 'Multa' }))).toBe(0);
    }
  });
});

describe('guardar em meta com tom', () => {
  const draft = (seed: string, title = 'Viagem') =>
    contributionDraftText({
      meta: `${title} (R$ 1.200,00 de R$ 3.000,00)`,
      title,
      amountCents: 20000,
      date: '2026-11-15',
      concludes: false,
      toneSeed: seed,
    });

  it('rascunho celebra com 1 emoji e mostra meta, valor e data', () => {
    for (const seed of SEEDS) {
      const text = draft(seed);
      expect(emojis(text)).toBe(1);
      expect(text).toContain('Meta: Viagem (R$ 1.200,00 de R$ 3.000,00)');
      expect(text).toContain(`Valor: ${formatBrl(20000)}`);
      expect(text).toContain('Data: 15/11/2026');
      expect(text.endsWith(CONFIRM)).toBe(true);
    }
  });

  it('meta sensivel no rascunho: sem emoji', () => {
    for (const seed of SEEDS) {
      expect(emojis(draft(seed, 'Tratamento de saúde'))).toBe(0);
    }
  });

  it('recibo celebra com 1 emoji e mantem o progresso', () => {
    for (const seed of SEEDS) {
      const text = contributionDoneText({
        title: 'Viagem',
        amountCents: 20000,
        currentCents: 140000,
        targetCents: 300000,
        percent: 46,
        achieved: false,
        toneSeed: seed,
      });
      expect(emojis(text)).toBe(1);
      expect(text).toContain(formatBrl(20000));
      expect(text.endsWith('Agora ' + formatBrl(140000) + ' de ' + formatBrl(300000) + ' (46%).')).toBe(true);
    }
  });

  it('recibo com meta concluida mantem a frase de conclusao', () => {
    const text = contributionDoneText({
      title: 'Viagem',
      amountCents: 20000,
      currentCents: 300000,
      targetCents: 300000,
      percent: 100,
      achieved: true,
      toneSeed: 'msg-1',
    });
    expect(text.endsWith('Meta concluída.')).toBe(true);
  });
});

describe('parcelado com tom atento', () => {
  it('rascunho sem emoji, com total e parcelas, e os dados da compra', () => {
    for (const seed of SEEDS) {
      const text = installmentDraftText({
        description: 'celular',
        totalCents: 150000,
        installmentsTotal: 10,
        firstDueDate: '2026-11-20',
        toneSeed: seed,
      });
      expect(emojis(text)).toBe(0);
      expect(text).toContain(formatBrl(150000));
      expect(text).toContain('10');
      expect(text).toContain('celular');
      expect(text).toContain('primeira em 20/11/2026');
    }
  });

  it('rascunho abre com a linha de tom atento antes dos dados', () => {
    for (const seed of SEEDS) {
      const first = installmentDraftText({
        description: 'celular',
        totalCents: 150000,
        installmentsTotal: 10,
        firstDueDate: '2026-11-20',
        toneSeed: seed,
      }).split('\n')[0];
      expect(first).toMatch(/^(Entendi:|Certo, compra parcelada:|Confira:) celular em 10/);
    }
  });

  it('recibo sem emoji e com as variantes de parcelado', () => {
    const texts = new Set<string>();
    for (const seed of SEEDS) {
      const text = installmentCreatedText({
        description: 'geladeira',
        totalCents: 120000,
        installmentsTotal: 12,
        firstDueDate: '2026-11-20',
        toneSeed: seed,
      });
      expect(emojis(text)).toBe(0);
      expect(text).toContain('geladeira');
      expect(text).toContain(formatBrl(120000));
      texts.add(text);
    }
    expect(texts.size).toBe(3);
  });
});

describe('regra geral de tom', () => {
  it('nenhum rascunho ou recibo tem mais de 1 emoji', () => {
    for (const seed of SEEDS) {
      const all = [
        expenseDraft(seed),
        incomeDraft(seed),
        doneText(TransactionType.INCOME, 100, 'x', null, { seed }),
        doneText(TransactionType.EXPENSE, 100, 'x', null, { seed }),
      ];
      for (const text of all) {
        expect(emojis(text)).toBeLessThanOrEqual(1);
      }
    }
  });
});
