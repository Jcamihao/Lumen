import { CARD_READ_REPLIES, cardListText, namedCardText } from './card-read';

describe('texto da leitura por cartao e da lista (9b-2)', () => {
  it('lista: padrao marcado, fechamento e vencimento quando houver, sem vencimento se nulo', () => {
    expect(
      cardListText([
        { name: 'Nubank', isDefault: true, closingDay: 5, dueDay: 12 },
        { name: 'Bradesco', isDefault: false, closingDay: 8, dueDay: null },
      ]),
    ).toBe('Seus cartões:\n- Nubank (padrão): fechamento dia 5, vencimento dia 12\n- Bradesco: fechamento dia 8');
  });

  it('lista vazia: resposta curta, sem cabecalho', () => {
    expect(cardListText([])).toBe(CARD_READ_REPLIES.none);
  });

  it('cartao nomeado: primeira linha diz o cartao e o corpo vem depois', () => {
    expect(namedCardText('Nubank', 'Limite do ciclo: R$ 2.000,00.')).toBe('Cartão: Nubank\nLimite do ciclo: R$ 2.000,00.');
  });

  it('nao casa: lista os nomes, sem erro; ambiguo pede o nome completo', () => {
    expect(CARD_READ_REPLIES.notFound('picapau', ['Nubank', 'Itaú'])).toBe('Não achei cartão com "picapau". Cartões: Nubank, Itaú.');
    expect(CARD_READ_REPLIES.ambiguous('vi', ['Vivo', 'Vivo Pad'])).toContain('Vivo, Vivo Pad');
  });
});
