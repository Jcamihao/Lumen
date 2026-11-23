# Resultado da 9a-1 (cartoes nomeados, so backend)

Data: 2026-11-23. Branch: feat/varios-cartoes. Implementador: agente haiku (Haiku 5.5).
Conferido por: somente o implementador. Conferencia independente e revisao sonnet ainda pendentes.

## Status
Codigo, migration e testes prontos e verdes em jest. Falta: migration em Postgres 16 real
(limpo e populado), revisao sonnet (item de isolamento exige revisor) e conferencia independente.

## Commits (branch feat/varios-cartoes)
- b39c99b feat(credit-cards): schema e migration dos cartoes nomeados
  - backend/prisma/schema.prisma; backend/prisma/migrations/20261123120000_credit_cards/migration.sql
  - Nao compila sozinho (ciclo ainda usa a chave antiga). Fechado pelo commit seguinte.
- 6fb2752 feat(credit-cycle): ciclo e teto pelo cartao padrao, com espelho no User
  - credit-cycle.service.ts, credit-cycle.util.ts, credit-cycle.service.spec.ts
  - insights.service.ts (+ spec): so a chave do teto, ver duvidas.md item 1
  - users.service.ts (+ spec): cadastro cria Principal na transacao; /users/me acompanha o padrao
  - prisma/seed.js: cartao padrao no usuario demo
- 6a6768f feat(credit-cards): modulo /credit-cards com isolamento, recibos e teto tecnico
  - src/credit-cards/{controller, service, module}.ts, dto/*.ts; backend/src/app.module.ts
- 687c63a test(credit-cards): isolamento A/B/C, concorrencia e falhas do servico
  - src/credit-cards/credit-cards.service.spec.ts (banco em memoria com dono, lock e falhas injetadas)
- Docs: este arquivo e duvidas.md (commit proprio, depois deste relatorio).

## O que mudou
- Schema: CreditCard (secao 2); CreditCycleCeiling.cardId (unico por cardId e data, NOT NULL);
  cardId opcional em Transaction, InstallmentPurchase e RecurringTransaction (FK SetNull, indice).
- Migration: cria CreditCard; backfill de um "Principal" padrao por usuario (idempotente via NOT EXISTS);
  indices unicos parciais em SQL; preenche cardId dos tetos; so depois NOT NULL; troca a unicidade do teto.
  Lancamentos antigos ficam com cardId nulo (contam no padrao).
- CreditCycleService: ciclo, configuracao e teto por cartao. /credit-cycle/* opera no padrao com a mesma resposta.
  Gasto do padrao soma CREDIT com cardId dele ou nulo; countAllPayments so no padrao (soma toda EXPENSE).
  Teto por (cardId, closingDate). Escritas sob FOR NO KEY UPDATE na linha do User, espelham os 3 campos do User.
- CreditCardsService + controller: GET/POST /credit-cards, GET/PATCH/DELETE /credit-cards/:id (DELETE arquiva),
  POST /credit-cards/:id/make-default, GET /credit-cards/:id/cycle, PUT /credit-cards/:id/ceiling.
  Cartao alheio = 404. Nome unico sem caixa (409). Teto tecnico de 10 ativos (MAX_ACTIVE_CARDS_PER_USER; 422;
  NAO e limite de plano). Arquivar o padrao = 409. Escritas devolvem recibo (id, name, closingDay, dueDay,
  countAllPayments, isDefault, refreshPending). Resultado desconhecido = CreditCardWriteUncertainError (500, sem repetir).
- Users: cadastro cria Principal na mesma transacao do User; /users/me com monthClosingDay atualiza o padrao na mesma transacao.
- Conversation: NAO alterado. isolation.fixture.ts NAO alterado.
- Dependencias: nenhuma nova. Comentarios/logs em portugues sem acento (conferido por grep nas linhas novas).

## Comandos e numeros
- npx prisma generate: ok (o cliente estava desatualizado; com ele tsc passa).
- npx prisma validate (DATABASE_URL de placeholder, sem conexao): "schema is valid", exit 0.
- npx tsc --noEmit -p tsconfig.json: exit 0 (antes e depois das mudancas).
- jest credit-cards + credit-cycle, TZ=UTC / America/Sao_Paulo / Asia/Tokyo: 3 suites, 84 testes, verde nas tres.
- Repeticao 15x (credit-cards, credit-cycle, users; TZ alternando): 15 de 15 com 97/97.
- Suite inteira, --maxWorkers=2: UTC 63 suites / 1731 testes; America/Sao_Paulo 63/1731; Asia/Tokyo 63/1731. Todas verdes.
- Mutantes (23 injetados, arquivo restaurado a cada um): 22 mortos, 1 equivalente (M20: countAllPayments
  so no padrao; sob o invariante nao-padrao nunca tem countAllPayments, entao o mutante e equivalente).
  M22 (cadastro sem Principal) foi reclassificado como morto: a primeira rodada deu sintaxe quebrada (suite nao compilou),
  a rerun com sintaxe valida deu 2 testes falhando.
  Lista: M01 lock do User na escrita; M02 nome nao checado; M03 nome sensivel a caixa; M04 findOwned sem userId;
  M05 alheio vira 409; M06 PATCH sem espelho; M07 make-default sem espelho; M08 antigo padrao nao limpo;
  M09 antigo mantem countAllPayments; M10 falha auxiliar relanca; M11 resultado desconhecido nao distinguido;
  M12 teto off-by-one; M13 arquivar nao grava; M14 countAllPayments em nao-padrao; M15 teto em arquivado;
  M16 teto sem lock; M17 cycle alheio sem userId; M18 padrao sem cardId nulo; M19 updateSettings sem espelho;
  M20 equivalente; M21 /users/me sem espelho; M22 cadastro sem Principal; M23 Principal com dia errado.
- graphify update . (raiz): exit 0, grafo reconstruido (graphify-out esta no .gitignore).
- git: nenhum push; nenhum amend/reset.

## NAO verificado (e por que)
- Postgres real: nao ha Docker daemon acessivel nem psql nesta maquina. A migration NAO foi aplicada.
  Nao foram feitos: banco limpo, banco populado com schema anterior, idempotencia de reexecucao,
  prisma migrate diff (exige shadow database). O revisor deve rodar isso.
- Indices unicos parciais e concorrencia real: as specs usam banco em memoria que simula lock e
  rollback; nao impoe os indices parciais nem prova o FOR NO KEY UPDATE contra PG.
- Falha controlada dentro de transacao real (queda no meio do commit): simulada no fake, nao em PG.
- Teto em concorrencia com promocao de padrao: sem teste dedicado (duvidas.md item 6).
- Swagger: so decorators; nao subi a API para conferir a documentacao.
- Lint/prettier: nao rodados (o users.service.ts original ja nao passa no prettier; nao reformatei o arquivo).
- Intermitencia: 15 repeticoes apenas das suites de cartao/ciclo/users; suite inteira rodou uma vez por fuso.

## Onde parou / pendencias
- Nada de codigo pendente.
- Pendente: migration em Postgres 16 (limpo e populado); revisao sonnet do isolamento; conferencia independente do principal;
  decidir sobre duvidas.md itens 1 e 6. 9a-2 (cardId em lancamento/parcelado/recorrencia) nao foi feita, como previsto.
- Incidente: HEAD ficou destacado durante a sessao (duvidas.md item 7); reatachado sem reset.
