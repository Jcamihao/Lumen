# Resultado 11b-1a: carteira compartilhada de lancamentos e categorias (backend)

Data: 2026-11-25. Executor: Claude Haiku 5.5 (subagente). Branch: feat/carteira-compartilhada-11b (worktree /home/caminhao/coding/codeStage/Lumen-11b). Revisao sonnet e conferencia do agente principal: PENDENTES (ver NAO verificado).

## Mudancas

- **Schema e migration** (`backend/prisma/schema.prisma`, `backend/prisma/migrations/20261125120000_carteira_compartilhada_lancamentos/migration.sql`): coluna nullable `sharedGroupOwnerId` em `Transaction` e `FinanceCategory` (FK User, ON DELETE SET NULL, indice). Nulo = privado. Migration escrita a mao (sem `migrate dev`).
- **AccessScopeService** (`backend/src/access-scope/`): ponto unico de decisao. `resolve` so devolve grupo e membros com membership ativa (ou pagador) E plano efetivo SHARED, conferidos na hora. `scopeWhere` (mine/shared/all), `canSeeItem`, `requireActiveGroupForSharing` (409 com code `SHARING_NEEDS_ACTIVE_GROUP`), `firstNamesById` (so primeiro nome).
- **Lancamentos** (`transactions/transactions.service.ts`, controller, DTO, `shared-transaction.view.ts`): `GET /transactions?scope=`; `PATCH /transactions/:id/sharing` (so autor, idempotente, recibo `{id,isShared,updatedAt}`); edicao e exclusao por parceiro com reconfirmacao sob `FOR NO KEY UPDATE` (User do autor primeiro, depois o item); visao do parceiro so com nome/cor da categoria, sem userId, sem id de categoria privada, sem envelope nem cartao.
- **Categorias** (`finance-categories/`): `GET ?scope=`; `PATCH :id/sharing`; parceiro edita so nome e cor de categoria compartilhada; exclusao so do autor; visao do parceiro sem orcamento nem userId.
- **Saida, remocao, aceite** (`billing/group.service.ts`): `leave`, `removeMember` e o aceite de convite que troca de grupo anulam a marca dos itens do membro que saiu, na mesma transacao, com a ordem de locks User do autor, membership, itens.
- **LGPD** (`users/users.service.ts`): cada lancamento e categoria proprios trazem `shared: boolean`; a marca interna nao vai para a exportacao.
- **Compatibilidade**: `GET /transactions` e `GET /finance-categories` sem `scope` (ou `mine`) devolvem o mesmo formato de antes (sem campos novos). Agregados, dashboard, insights, ciclo, bot e importacao nao mudaram (continuam por userId).
- **Testes**: `backend/src/access-scope/read-scope.ts` (tabela do where), `access-scope.service.spec.ts` (regras de resolve), `isolation.spec.ts` (4 contas A, B, C, D, com servicos reais sobre `shared-fake-db.fixture.ts`), testes novos e ajustes de construtor nos specs de transactions, finance-categories e group.

## Comandos e numeros

- `npx prisma validate` (com DATABASE_URL dummy, sem conectar): valido. 2026-11-25.
- `npx prisma migrate diff --from-schema-datamodel <schema HEAD> --to-schema-datamodel prisma/schema.prisma --script`: 4 statements (2 ADD COLUMN, 2 CREATE INDEX, 2 ADD CONSTRAINT), iguais ao que esta na migration escrita a mao.
- `npx tsc --noEmit`: sem erro. 2026-11-25.
- Subset (`src/access-scope src/billing src/transactions src/finance-categories src/users`): 16 suites, 304 testes verdes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo. 2026-11-25.
- Suite inteira, TZ=UTC, `--maxWorkers=2`: 93 suites, 2393 testes verdes. 2026-11-25.
- `graphify update .`: grafo atualizado (AST). 2026-11-25.

## Mutantes (28 mutacoes em codigo de compartilhamento)

Mortos (26): 
1 read-scope: sem grupo, shared vira mine. 
2 read-scope: partnerIds inclui o proprio leitor. 
3 read-scope: shared sem o filtro sharedGroupOwnerId (uma primeira tentativa dava erro de compilacao; refeita como mutacao comportamental, morta por 2 testes). 
4 resolve: checagem de plano SHARED removida. 
6 canSeeItem: sem checar membro ativo do autor. 
7 canSeeItem: atalho do dono removido. 
8 requireActiveGroupForSharing: sem 409. 
10 setSharing: sem lock do User do autor (morta pelo teste de ordem de locks). 
11 parceiro: checagem de campos restritos com every em vez de some. 
12 parceiro: categoria escolhida sem checar visibilidade. 
13 lockReachable: sem reconfirmacao de visibilidade sob o lock (mortas as corridas). 
14 404 vira 403 (vazaria existencia). 
15 GET /transactions sem scope vira all. 
16 setSharing sem idempotencia. 
17 desmarcar exige grupo ativo. 
18 visao do parceiro com categoria inteira (vaza id e orcamento). 
19 visao do parceiro com shared false. 
20 visao do parceiro com userId. 
21 categoria: parceiro pode apagar. 
22 categoria: parceiro pode mudar orcamento ou icone. 
23 categoria: visao do parceiro com monthlyBudget. 
24 exportacao de categoria com shared false. 
25 leave sem anular marca dos itens. 
26 removeMember sem anular marca dos itens. 
27 aceite de convite em outro grupo sem anular marca dos itens anteriores. 
28 firstNameOf sem cortar no primeiro espaco (nome inteiro).

Equivalentes (2): 
5 resolve: membership sem `leftAt: null`. Equivalente: a checagem de plano roda antes e, sem membership ativa, o plano volta FREE e o resolve devolve NO_ACCESS. 
9 resolve: checagem de plano do autor removida. Equivalente sob o invariante atual: membro ativo de G tem plano SHARED pela assinatura de G, mesma regra do leitor. Mantida como defesa em profundidade.

Sobreviventes sem equivalencia: nenhum.

## NAO verificado

- **Postgres real**: nenhuma migration aplicada em banco. Sem Docker nesta fatia e sem binario postgres local. Feito so o `migrate diff` e o `validate` acima. `migrate deploy` em banco limpo e `migrate diff` contra o banco: pendentes.
- **Concorrencia real** (FOR NO KEY UPDATE entre conexoes): nao testada. Os testes de corrida sao intercalacao deterministica com o fake (gancho no momento do lock). Pendente de integracao real.
- **Endpoints HTTP**: testados por servico, nao por requisicao (sem supertest/e2e nesta fatia). Os controllers so repassam.
- **Plano lido fora da transacao**: EntitlementsService.resolvePlan usa o prisma fora do tx; o plano nao e travado. Queda de plano no meio da escrita fica para a webhook do Asaas (aceito: a leitura seguinte pausa).
- **Outros endpoints** que devolvem linha crua de Transaction ou FinanceCategory passam a trazer o campo `sharedGroupOwnerId` (nulo ou id do pagador do proprio usuario). Nao verificado item a item.
- **Exclusao de conta**: coberta pelo schema (onDelete Cascade no dono e SET NULL na marca) e por teste do modelo; cascata real nao rodou.
- **Testes intermitentes** (15 ou 30 rodadas): nao rodados. Os testes nao usam relogio real nem timers, mas nao foi medido.
- **Suite inteira em outros fusos**: so o subset roda em TZ=UTC, America/Sao_Paulo e Asia/Tokyo; a suite inteira so em UTC.
- **Lint e prettier**: nao rodados.
- **Revisao sonnet e conferencia do agente principal**: pendentes. Duvidas de produto em duvidas.md.
