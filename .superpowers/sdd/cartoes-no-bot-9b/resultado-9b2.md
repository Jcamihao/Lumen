# Resultado 9b-2: leitura por cartao e "meus cartoes" pela conversa

Data: 2026-11-24. Branch: feat/cartoes-no-bot (sem troca). Implementado por Claude Haiku 5.5 (agente implementador). Revisao sonnet: NAO feita nesta fatia. Conferencia independente do agente principal: pendente.

## Comportamento
- "cartao <nome>", "limite do cartao <nome>", "quanto sobrou no cartao <nome>": explicito. Nome casa como no 8d (sem acento/caixa, igual ou contem). Casa um: leitura do ciclo desse cartao (getCycleForCard) com a linha "Cartao: <nome>". Nao casa ou casa mais de um: lista dos cartoes ativos, sem erro, sem consultar ciclo.
- "limite do <nome>", "quanto sobrou no <nome>", "quanto gastei no <nome>", "fatura do <nome>" (sem a palavra cartao): so viram leitura se <nome> for EXATO (sem acento/caixa) de um cartao ativo do dono. Caso contrario, segue o caminho de hoje (ajuda/IA). Frase com "?" ou nome com mais de 4 palavras nao vira leitura nessa forma.
- Sem nome ("cartao", "quanto sobrou no cartao", "limite do cartao", "fatura do cartao"): cartao padrao, texto igual ao de antes.
- "limite do <nome> <valor>" continua escrita (8d). "limite do cartao 2000" continua leitura do padrao.
- "meus cartoes", "quais cartoes", "listar cartoes", "meus cartoes de credito" (frase exata): lista somente leitura de cartoes ativos, padrao primeiro e depois por nome (mesma ordem do 8d), com "(padrao)" no padrao e fechamento/vencimento. Sem cartao ativo: "Voce ainda nao tem cartao ativo."
- Isolamento: sempre por userId do vinculo. Cartao alheio = inexistente (mesma resposta). Arquivado nao aparece nem casa.
- Sem mudanca de schema, migration, escrita (9b-1) nem 8d.

## Mudancas de codigo
- `backend/src/conversation/parsers/intent.matcher.ts`: intent credit_card com cardTerm/loose (matchCardRead), list_cards (LIST_CARD_PHRASES), cabecas de leitura.
- `backend/src/conversation/card-read.ts` (novo): textos puros (lista, linha do cartao nomeado, nao achei, ambiguo, sem cartao).
- `backend/src/conversation/conversation.service.ts`: resolveLooseCardRead (forma loose so vale com nome exato, senao null como antes), creditCardReply, listCardsReply, cycleCardView, leitura com cardTerm; READ_INTENTS aceita list_cards.
- Ajuste de expectativa em `intent.matcher.credit-limit.spec.ts`: "limite do nubank" e "limite do nubank estourou" agora saem do matcher como leitura loose (o servico decide pelo nome exato). Antes eram null. O comportamento para o usuario nao mudou para nome que nao e cartao.

## Testes (novos)
- `intent.matcher.credit-limit.spec.ts`: bloco "leitura por cartao e meus cartoes (9b-2)" (explicito, loose, pergunta, forma sem nome, com valor, lista).
- `card-read.spec.ts` (novo): texto da lista (sem vencimento, vazio), linha do cartao, nao achei/ambiguo.
- `credit-limit-change.spec.ts`: bloco 9b-2 (nome dito, acento/caixa, inexistente, ambiguo, loose exato e parcial, padrao, arquivado, isolamento A/B, lista, ordem do 8d, sem cartao). CARDS ganhou closingDay/dueDay e um cartao arquivado.
- `isolation.spec.ts`: bloco 11 (cartao de B nao casa para A com a mesma resposta do inexistente; loose de A com nome de B nao le; B le o proprio; lista so do dono; C sem cartao).
- `isolation.fixture.ts`: getCycleForCard no fake (NotFound se o cartao nao e do dono); cartoes com closingDay/dueDay.

## Comandos e numeros (2026-11-24)
- `cd backend && npx tsc --noEmit`: limpo (exit 0).
- `npx jest src/conversation src/credit-cards src/transactions src/telegram --maxWorkers=2`: 33 suites, 1063 testes verdes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo.
- `npx jest --maxWorkers=2` (suite inteira, TZ=UTC): 87 suites, 2190 testes verdes.
- Linha de base da 9b-1: 2164 testes na suite inteira; +26 nesta fatia.
- `graphify update .`: grafo atualizado.

## Mutantes proprios (14; rodados em intent.matcher.credit-limit, card-read, credit-limit-change e isolation: 113 testes)
Mortos 14, sobreviventes 0 no fim, equivalentes 0.
- M1 explicito sempre (sem loose): morto (5).
- M2 sem checagem de "?" no loose: morto (2).
- M3 "meus cartoes" sem "listar cartoes": morto (1).
- M4 resolve loose fuzzy (contem em vez de igual): morto (1).
- M5 resolve loose sem checar nome (bypass): morto (1).
- M6 ambiguo pega o primeiro: morto (1).
- M7 nomeado usa cartao padrao: morto (4).
- M8 lista sem filtro de arquivado: morto (1).
- M9 lista sem orderBy: morto (1).
- M10 sem marca de padrao: morto (4).
- M11 nomeado sem linha do cartao: morto (7).
- M12 activeCards sem userId (where userId undefined): morto (11).
- M13 conta sem cartao cai na lista: SOBREVIVEU na 1a rodada; coberto com 1 asserção em isolation (C: "cartao Nubank" = "Voce ainda nao tem cartao ativo."); agora morto (1).
- M14 "quanto gastei no" sem loose: morto (1).
Sobreviventes finais: nenhum. Equivalentes: nenhum.

## NAO verificado
- Integracao real em Postgres/Redis descartaveis e docker: NAO feita (brief manda sem Docker nesta fatia). Os testes de servico usam mocks e fakes de Prisma (isolation.fixture).
- Canal Telegram e WhatsApp com a leitura nova: NAO testado com adaptador real (so o texto no servico).
- Cartao arquivado entre leitura e lista em banco real: NAO testado (so mock).
- Nome com mais de um cartao na forma loose ("limite do vi"): caminho de hoje, nao lista (duvida 5).
- Revisao sonnet e conferencia independente do agente principal: NAO feitas.

## Duvidas abertas
Ver `.superpowers/sdd/cartoes-no-bot-9b/duvidas.md`, itens 4 a 6 (forma sem a palavra cartao: casamento parcial, lista em caso ambiguo, "quanto gastei no credito").

## Proximos passos
1. Revisao sonnet com mutantes e banco real (Postgres/Redis descartaveis).
2. Conferencia independente do agente principal.
3. Decisao do dono sobre duvidas 4 a 6.
4. Depois: 9b-3 (criar e renomear cartao por conversa).
