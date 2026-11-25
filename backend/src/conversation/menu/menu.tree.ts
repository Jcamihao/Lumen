import { MenuNode } from './menu.types';

export const MENU_ROOT_ID = 'menu';

/** Arvore unica do menu, independente de canal. So o que o bot ja faz; Tarefas e Avisos/Conta entram nas fases 12.2 e 12.3. */
export const MENU_ROOT: MenuNode = {
  id: MENU_ROOT_ID,
  title: 'Menu',
  children: [
    {
      id: 'inicio',
      title: '🏠 Início',
      children: [
        { id: 'inicio.saldo', title: 'Saldo', example: 'como está o meu saldo?', action: { type: 'phrase', phrase: 'saldo' } },
        { id: 'inicio.resumo', title: 'Resumo do mês', example: 'resumo do mês', action: { type: 'phrase', phrase: 'resumo' } },
        { id: 'inicio.gastos', title: 'Gastos do mês', example: 'quanto gastei este mês?', action: { type: 'phrase', phrase: 'gastos do mes' } },
        { id: 'inicio.vencimentos', title: 'Próximos vencimentos', example: 'o que vence esta semana', action: { type: 'phrase', phrase: 'proximos vencimentos' } },
      ],
    },
    {
      id: 'financas',
      title: '💰 Finanças',
      children: [
        { id: 'financas.despesa', title: 'Lançar despesa', example: 'gastei 50 no mercado', action: { type: 'phrase', phrase: 'gastei' } },
        { id: 'financas.receita', title: 'Lançar receita', example: 'recebi 800 de freelance', action: { type: 'phrase', phrase: 'recebi' } },
        {
          id: 'financas.categorias',
          title: 'Gastos por categoria',
          example: 'gastos com mercado',
          action: { type: 'instruction', text: 'Para ver uma categoria, diga o nome dela. Ex.: gastos com mercado.' },
        },
        { id: 'financas.reservas', title: 'Reservas', example: 'como está minha reserva', action: { type: 'phrase', phrase: 'reservas' } },
        { id: 'financas.fixas', title: 'Contas fixas', example: 'minhas contas fixas', action: { type: 'phrase', phrase: 'contas fixas' } },
        { id: 'financas.parcelados', title: 'Parcelados', example: 'minhas parcelas', action: { type: 'phrase', phrase: 'parcelados' } },
        {
          id: 'financas.editar',
          title: 'Editar lançamento',
          example: 'editar gasto mercado',
          action: { type: 'instruction', text: 'Para editar um lançamento, diga o nome dele. Ex.: editar gasto mercado.' },
        },
        {
          id: 'financas.apagar',
          title: 'Apagar lançamento',
          example: 'apagar gasto mercado',
          action: { type: 'instruction', text: 'Para apagar um lançamento, diga o nome dele. Ex.: apagar gasto mercado.' },
        },
      ],
    },
    {
      id: 'cartao',
      title: '💳 Cartão',
      children: [
        { id: 'cartao.lista', title: 'Meus cartões', example: 'quais são meus cartões?', action: { type: 'phrase', phrase: 'meus cartoes' } },
        { id: 'cartao.limite', title: 'Limite e fatura', example: 'como está meu cartão?', action: { type: 'phrase', phrase: 'limite do cartao' } },
        { id: 'cartao.definir', title: 'Definir limite', example: 'definir limite do cartão 5000', action: { type: 'phrase', phrase: 'definir limite' } },
        {
          id: 'cartao.limpar',
          title: 'Limpar limite',
          example: 'limpar limite Nubank',
          action: { type: 'instruction', text: 'Para tirar o teto de um cartão, diga: limpar limite e o nome do cartão. Ex.: limpar limite Nubank.' },
        },
        {
          id: 'cartao.criar',
          title: 'Criar cartão',
          example: 'criar cartão Nubank',
          action: { type: 'instruction', text: 'Para criar um cartão, diga: criar cartão Nubank.' },
        },
        {
          id: 'cartao.renomear',
          title: 'Renomear cartão',
          example: 'renomear cartão Nubank para Roxinho',
          action: { type: 'instruction', text: 'Para renomear um cartão, diga: renomear cartão Nubank para Roxinho.' },
        },
      ],
    },
    {
      id: 'metas',
      title: '🎯 Metas',
      children: [
        { id: 'metas.lista', title: 'Minhas metas', example: 'como estão minhas metas?', action: { type: 'phrase', phrase: 'minhas metas' } },
        { id: 'metas.criar', title: 'Criar meta', example: 'criar meta viagem', action: { type: 'phrase', phrase: 'criar meta' } },
        {
          id: 'metas.guardar',
          title: 'Guardar numa meta',
          example: 'guardar 200 na viagem',
          action: { type: 'instruction', text: 'Para guardar dinheiro numa meta, diga: guardar 200 na viagem.' },
        },
        {
          id: 'metas.editar',
          title: 'Editar meta',
          example: 'editar meta viagem',
          action: { type: 'instruction', text: 'Para editar uma meta, diga: editar meta viagem.' },
        },
        {
          id: 'metas.apagar',
          title: 'Apagar meta',
          example: 'apagar meta viagem',
          action: { type: 'instruction', text: 'Para apagar uma meta, diga: apagar meta viagem.' },
        },
      ],
    },
    { id: 'ajuda', title: '❓ Ajuda', example: 'o que você faz?', action: { type: 'phrase', phrase: 'ajuda' } },
  ],
};
