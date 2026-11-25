# Resultado 9a-4: filtro do cartao padrao so com despesa

Data: 2026-11-23. Branch: feat/varios-cartoes. Executor: Claude Haiku 5.5 (agente principal, sem subagente). Conferencia: o proprio agente; revisao independente por sonnet NAO feita (pendente).

## Decisao aplicada
Dono (2026-11-23, "sim"): no cartao padrao, o ramo de CREDIT com cardId nulo inclui so DESPESA (type EXPENSE). Receita CREDIT sem cartao nao entra. Cartao secundario nao mudou.

## Mudancas
- `backend/src/credit-cycle/credit-cycle.util.ts`: `cardScopeWhere` (padrao) passa a ser `{ OR: [{ cardId: id }, { cardId: null, paymentMethod: 'CREDIT', type: EXPENSE }] }`. Comentarios atualizados.
- Commit `d320cf6` fix(credit-cards): so a parte de codigo.
- Commit `e7035b9` test(credit-cards): atualizados os where exatos em `credit-cycle.util.spec.ts`, `credit-cycle.service.spec.ts`, `insights.service.spec.ts`, `transactions.card-link.spec.ts`; em `transactions.card-filter.spec.ts` nova linha `a-receita-credit` (INCOME CREDIT sem cartao) e teste que ela nao entra no padrao.
- Gasto do ciclo (`cardSpendWhere`) continua igual na semantica: o where externo ja tinha `type: EXPENSE`; so o OR interno ganhou o mesmo filtro.
- Sem mudanca de schema nem migration. Nenhum container tocado.

## Comandos e numeros
- `cd backend && npx tsc --noEmit`: exit 0.
- Modulos (`src/credit-cycle src/credit-cards src/transactions src/insights src/conversation`, maxWorkers=2):
  - UTC: 23 suites, 949 testes verdes.
  - America/Sao_Paulo: 23 suites, 949 verdes.
  - Asia/Tokyo: 23 suites, 949 verdes.
- Suite inteira (`npx jest --maxWorkers=2`, TZ padrao): 73 suites, 1932 testes verdes.
- `graphify update .`: exit 0 (grafo reconstruido; graphify-out e ignorado pelo git).

## Mutantes (no util, restaurado depois; restauracao conferida)
Rodados sobre `src/credit-cycle src/transactions src/insights`:
| Mutante | Resultado |
|---|---|
| M1 tira `type` do ramo nulo | MORTO (7 falhas) |
| M2 EXPENSE -> INCOME no ramo nulo | MORTO (10 falhas) |
| M3 tira `paymentMethod` do ramo nulo | MORTO (6 falhas) |
| M4 tira o OR do padrao | MORTO (10 falhas) |
| M5 tira `cardId: null` do ramo nulo | MORTO (10 falhas) |
| M6 secundario recebe os nulos | MORTO (7 falhas) |

Sobreviventes: nenhum. Equivalentes: nenhum identificado.

## NAO verificado
- Integracao em Postgres real: nao feita nesta fatia (filtro testado com where avaliado em memoria e where exato).
- Revisao independente (sonnet) e revisao de seguranca do isolamento: nao feitas.
- Teste de integracao com containers descartaveis: nao feito.
