# Contrato: menu guiado do bot (listas e fluxos em vez de "diga: ...")

Data: 2026-11-26. Origem: pedido do dono no Telegram real. Decisões do dono: "recomendações" nas três perguntas de categoria; "editar categoria" também entra.

## Problema
Nove folhas do menu só respondem com um guia de texto ("Para apagar um lançamento, diga: apagar gasto mercado"). O usuário tem de adivinhar a frase. O motor já tem listas numeradas para escolher lançamento, meta e reserva (contratos 8a e 8b); falta ligar os botões a elas.

## Regras gerais
- G1. Toda folha que age sobre algo existente mostra primeiro uma **lista compacta** do que existe; o usuário escolhe pelo número (ou pelo botão, no Telegram).
- G2. Lista de lançamentos: 15 por página, mais recentes primeiro, linha `N. 26/11 · Padaria · R$ 3,00`. Há mais? "mais" mostra os 15 seguintes. Sem lançamentos: mensagem amigável e dica de como lançar.
- G3. Listas curtas (metas, cartões, categorias) não paginam; teto de itens como hoje nas telas.
- G4. Nenhuma folha grava sozinha: escolher item abre o fluxo de rascunho e confirmação que já existe (editar/apagar com confirmação).
- G5. Isolamento: a lista vem sempre do usuário autenticado; nunca do que o cliente envia.
- G6. Cada folha continua mostrando a dica "da próxima vez, é só dizer: ..." depois do resultado.

## Fatias (cada uma: código, testes, merge --no-ff na develop)
1. **Editar e apagar lançamento**: lista dos últimos 15 com paginação; escolher abre o fluxo 8a existente.
2. **Categorias** (substitui "Gastos por categoria" por um submenu 🏷️ Categorias):
   - 📋 Ver gastos: categorias com o total do mês; escolher uma mostra os gastos dela.
   - ➕ Criar categoria: pergunta o nome e depois o tipo (despesa ou receita). Cor automática, sem ícone, sem orçamento (D1 e D3, recomendações aceitas).
   - ✏️ Editar categoria: lista; escolher e dizer o novo nome. Só o nome (cor, ícone e orçamento ficam no app).
   - 🗑️ Excluir categoria: lista; confirmação com o aviso "Os lançamentos dela ficam sem categoria". Só as categorias do próprio usuário (D2: a do parceiro nunca é excluída nem editada pelo bot, regra que a API já tem).
   - Ao lançar despesa ou receita, a pergunta "Qual a categoria?" lista sempre as categorias do tipo certo, mais "sem categoria", e termina com a dica: "Quer outra? Em Finanças → Categorias você cria, edita ou exclui."
3. **Metas**: guardar, editar e apagar começam por lista de metas.
4. **Cartão**: limpar limite e renomear começam por lista de cartões; criar cartão pergunta o nome e segue o fluxo existente (dia de fechamento).
5. **Conferência** dos fluxos Lançar receita, Definir limite e Criar meta: cada um deve guiar campo a campo.

## Fora do escopo
Tarefas e Avisos/Conta (fases 12.2 e 12.3), orçamento mensal por categoria pelo bot, compartilhar categoria pelo bot.

## Como cada fatia é verificada
Testes do motor (mundo falso, como `menu-action.spec.ts`), mutantes, suíte em 3 fusos, e teste no Telegram real pelo dono. Gravação sempre pelos mesmos serviços da API (`TransactionsService`, `FinanceCategoriesService`, `GoalsService`, `CreditCardsService`).
