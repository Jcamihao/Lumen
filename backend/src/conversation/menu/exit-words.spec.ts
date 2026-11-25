import { exitKindOf } from './exit-words';

describe('saida universal', () => {
  it.each([
    ['cancelar', 'CANCEL'],
    ['cancela', 'CANCEL'],
    ['parar', 'CANCEL'],
    ['desistir', 'CANCEL'],
    ['deixa pra la', 'CANCEL'],
    ['deixa pra lá', 'CANCEL'],
    ['Deixa Quieto!', 'CANCEL'],
    ['esquece', 'CANCEL'],
    ['chega', 'CANCEL'],
    ['voltar', 'MENU'],
    ['sair', 'MENU'],
    ['menu', 'MENU'],
    ['Início', 'MENU'],
    ['inicio', 'MENU'],
    ['comecar', 'MENU'],
    ['começar', 'MENU'],
    ['start', 'MENU'],
    ['  VOLTAR  ', 'MENU'],
  ])('"%s" sai como %s', (text, kind) => {
    expect(exitKindOf(text)).toBe(kind);
  });

  it.each(['nao', 'não', 'ok', 'sim', 'confirmar', 'apagar', 'limpar', 'ajuda', 'saldo', ''])('"%s" nao sai', (text) => {
    expect(exitKindOf(text)).toBeNull();
  });

  it.each(['voltar pro saldo', 'menu de financas', 'quero cancelar', 'sair do cartao', 'chega de gastar', 'cancelar tudo agora'])(
    'palavra de saida no meio de frase maior nao vale: "%s"',
    (text) => {
      expect(exitKindOf(text)).toBeNull();
    },
  );
});
