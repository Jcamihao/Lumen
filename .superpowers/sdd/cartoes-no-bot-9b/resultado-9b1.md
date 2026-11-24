# Resultado 9b-1: lancar despesa no cartao pela conversa

Data: 2026-11-24. Branch: feat/cartoes-no-bot. Implementado por Claude Haiku 5.5 (agente implementador). Conferencia independente pelo agente principal: pendente. Revisao sonnet: NAO feita nesta fatia.

## Mudancas
- `backend/src/conversation/card-expense.ts` (novo): parser puro `findCardPhrase` (no/na/do/da <cartao>, "no credito/cartao" com ou sem nome, explicito inexistente/ambiguo), `removeTokenRange`, textos da lista.
- `backend/src/conversation/conversation.service.ts`: rascunho de despesa ganha cardId/cardName/CREDIT; "credito" sem nome: 1 cartao usa ele, 2+ deixa pendingField 'card' (pergunta depois do valor e da categoria); resposta por numero (1-5) ou nome; confirmacao grava pelo TransactionsService.create com cardId; recusa de cartao arquivado/removido/alheio vira mensagem do dominio (nada gravado); recibo "... no cartao X.".
- `conversation.types.ts`: PendingField 'card'; ExpenseOrIncomeDraft com cardId, cardName, cardOptions (opcionais, rascunho antigo = null).
- `replies.ts`: draftText mostra "Cartao: X"; doneText aceita cardName.
- Testes: `card-expense.spec.ts` (novo, 25 casos); `isolation.spec.ts` (bloco 10, 2 casos com cartoes de A e B); `isolation.fixture.ts` (cards por dono: A Nubank; B Itau e Bradesco; C nenhum); `transaction-change.spec.ts` (fake ganhou creditCard).
- Sem mudanca de schema nem migration.

## Comandos e numeros (TZ conferido por execucao)
- `cd backend && npx tsc --noEmit`: limpo (antes e depois).
- `npx jest src/conversation src/credit-cards src/transactions --maxWorkers=2`: 963 testes, 27 suites verdes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo.
- `npx jest --maxWorkers=2` (suite inteira, TZ=UTC): 81 suites, 2090 testes verdes.
- `graphify update .` na raiz: grafo atualizado (5874 nos, 13060 arestas).
- Antes da mudanca: 936 testes verdes nas tres pastas (linha de base).

## Mutantes (alvo: card-expense.spec, isolation.spec, conversation.service.spec; 365 testes)
Mortos (16):
- M1 termo implicito sem normalize (caixa/acento): morto (2 falhas).
- M2 "no credito" sem nome nao e mais pedido: morto (5).
- M3 cartao escolhido sem CREDIT: morto (6).
- M4 escolha de cartao nao vira pergunta depois do valor: morto (3).
- M5c cartao explicito nao casado grava sem erro: morto (5).
- M6 lista de cartoes sem filtro de userId: morto (4).
- M7 confirmacao nao manda cardId: morto (2).
- M8 recibo sem o cartao: morto (1).
- M9b recusa de cartao vira generica: morto (1).
- M10 receita tambem casa cartao: morto (1).
- M11 "no credito" sem cartao tira o trecho da descricao: morto (1).
- M12 resposta numerica da escolha ignorada: morto (1).
- M13 ambiguidade explicita tratada como nao casado: morto (2).
- M14 cartao arquivado oferecido na lista: morto (1).
- M15 escolha sem lista oferecida (cardOptions vazio): morto (3).
- M16 cartao casado nao tira o trecho da descricao: morto (8).
- M18 resposta pelo nome da escolha desligada: morto (1).

Sobreviventes: nenhum.
Equivalentes: nenhum identificado.
Nota: tres variantes nao compilaram (M5 com if(false); M5b com comparacao impossivel apos o narrowing do TS; M9 com "&& false") e nao contam como mortos. Foram substituidas por M5c (notFound grava sem erro, morto) e M9b (recusa generica, morto).

## Decisoes tomadas (sem duvida de produto no contrato)
- Cartao explicito "no cartao X" com X inexistente ou ambiguo responde a lista e nao grava (contrato, secao 2 do brief).
- Lookup de cartao pelo nome sem acento e caixa (matchCardsByTerm); no implicito so nome igual, para "no mercado" nao virar cartao.
- Cartao arquivado nao entra na lista nem casa; na confirmacao, a recusa vem do TransactionsService (resolveCardForCreate).

## Duvidas abertas (em duvidas.md)
Ver /home/caminhao/coding/codeStage/Lumen/.superpowers/sdd/cartoes-no-bot-9b/duvidas.md: "credito" sem cartao cadastrado; receita com "no <nome>"; escolha numerica acima de 5 cartoes; "no credito <palavra>" que nao e cartao; nome de loja igual a cartao.

## NAO verificado
- Integracao real em Postgres/Redis descartaveis e docker run: NAO feita (brief manda deixar para a revisao sonnet).
- Revisao sonnet e conferencia independente do agente principal: NAO feitas.
- Cartao arquivado na confirmacao foi provado com o mock do TransactionsService (rejeicao 400), nao com o servico real; o servico real tem cobertura em transactions.card-link.spec (dentro da suite inteira, verde).
- Concorrencia com make-default durante o rascunho: NAO testada nesta fatia.
- Cartao com nome igual ao de loja: limitacao aceita no contrato, nao testada alem do caso "mercado pago" do parser.
- Mais de 5 cartoes: a escolha por numero e so de 1 a 5; acima disso so pelo nome (nao testado com 6 cartoes).
- Receita com "no <nome>": o trecho fica na descricao (decisao provisoria, duvida 2).
