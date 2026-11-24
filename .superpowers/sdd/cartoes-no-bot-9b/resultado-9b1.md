# Resultado 9b-1: lancar despesa no cartao pela conversa

Data: 2026-11-24. Branch: feat/cartoes-no-bot. Implementado por Claude Haiku 5.5 (agente implementador). Conferencia independente pelo agente principal: pendente. Revisao sonnet: NAO feita nesta fatia.

## Commits
- Primeira entrega: 2d201bd (feat), 0904422 (test), 56f6e86 (docs), a02819a (docs: correcao de nota).
- Ajuste "recomendacoes" (decisoes do dono, 2026-11-24): 2c50293 (fix), 1250a0c (test), e este docs.

## Comportamento atual
- "no/na/do/da <cartao>" casa cartao ATIVO do dono (sem acento e caixa): grava CREDIT + cardId; rascunho e recibo mostram o cartao. Nome que nao casa: a frase fica na descricao (ex.: "no mercado").
- "no cartao <X>" explicito com X inexistente ou ambiguo: responde a lista (ou pede o nome completo) e NAO grava.
- "no credito" sem nome: 1 cartao ativo usa ele; 2 ou mais pergunta a lista (numero 1 a 5 ou nome) depois do valor e da categoria; NENHUM cartao ativo: grava CREDIT sem cardId (conta no padrao, regra da 9a).
- "no credito <palavra que nao e cartao>" (ex.: "no credito padaria"): a palavra vira descricao, CREDIT sem cardId (cartao padrao). Nao recusa.
- Receita ignora o cartao; o trecho continua na descricao (duvida 1).
- Confirmacao: TransactionsService.create com cardId (quando houver), mesma regra de arquivado/alheio/inexistente; recusa de cartao vira mensagem do dominio e nada e gravado.
- Cartao arquivado nao entra na lista nem casa.
- Sem mudanca de schema nem migration.

## Mudancas de codigo
- `backend/src/conversation/card-expense.ts` (novo): `findCardPhrase` (kinds card, credit, creditDefault, notFound, ambiguous), `removeTokenRange`, textos da lista.
- `backend/src/conversation/conversation.service.ts`: rascunho, pergunta do cartao, escolha, confirmacao, recusa e recibo.
- `conversation.types.ts`: PendingField 'card'; cardId, cardName, cardOptions opcionais.
- `replies.ts`: "Cartao: X" no rascunho; doneText com cardName.
- Testes: `card-expense.spec.ts` (novo, 27 casos); `isolation.spec.ts` (bloco 10); `isolation.fixture.ts` (cards por dono: A Nubank; B Itau e Bradesco; C nenhum); `transaction-change.spec.ts` (fake com creditCard).

## Comandos e numeros
- `cd backend && npx tsc --noEmit`: limpo.
- `npx jest src/conversation src/credit-cards src/transactions --maxWorkers=2`: 967 testes, 27 suites verdes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo.
- `npx jest --maxWorkers=2` (suite inteira, TZ=UTC): 81 suites, 2094 testes verdes.
- `graphify update .`: grafo atualizado.
- Linha de base antes da 9b-1: 936 testes verdes nas tres pastas.

## Mutantes
Primeira rodada (alvo: card-expense.spec, isolation.spec, conversation.service.spec; 365 testes): 16 mortos (M1 a M4, M5c, M6 a M16 exceto M17, M9b, M18). Nenhum sobrevivente, nenhum equivalente. Variantes que nao compilaram (if(false), narrowing do TS, "&& false") nao contam.

Rodada do ajuste (369 testes): 7 novos, todos mortos.
- N1 "no credito <palavra>" vira recusa: morto (3).
- N2 "no credito <palavra>" ganha o primeiro cartao: morto (2).
- N3 "no credito" sem nenhum cartao nao grava CREDIT: morto (1).
- N4 "no credito" sem cartao deixa o trecho na descricao: morto (1).
- N5 "credito" fica na descricao de "no credito <palavra>": morto (3).
- N6 "no cartao <inexistente>" passa a ser descricao: morto (6).
Sobreviventes: nenhum. Equivalentes: nenhum identificado. (Primeira tentativa de N3 nao compilou e foi refeita com condicao valida.)

## Decisoes do dono aplicadas (2026-11-24)
- "no credito" sem nenhum cartao ativo: CREDIT sem cardId.
- "no credito <palavra que nao e cartao>": descricao + CREDIT sem cardId, sem recusa.
- "no cartao <nome inexistente>" continua recusando com a lista.
- Duvidas 2, 3 e 5 mantidas como estao (duvidas.md).

## NAO verificado
- Integracao real em Postgres/Redis descartaveis e docker run: NAO feita (brief manda deixar para a revisao sonnet).
- Revisao sonnet e conferencia independente do agente principal: NAO feitas.
- Cartao arquivado na confirmacao foi provado com mock do TransactionsService (rejeicao 400), nao com o servico real; o servico real tem cobertura em transactions.card-link.spec (dentro da suite inteira, verde).
- Concorrencia com troca de padrao durante o rascunho: NAO testada.
- Mais de 5 cartoes: escolha por numero so de 1 a 5; nao testado com 6 cartoes.
- Receita com "no <nome>": trecho fica na descricao (duvida 1).

## Duvidas abertas
Ver /home/caminhao/coding/codeStage/Lumen/.superpowers/sdd/cartoes-no-bot-9b/duvidas.md (receita com "no <nome>", escolha acima de 5 cartoes, nome de loja igual a cartao).
