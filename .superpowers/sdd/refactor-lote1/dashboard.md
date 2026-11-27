# Revisao refactor lote 1: dashboard.service (2026-11-27, Sonnet 5.5)

## Conferencia linha a linha
- Consultas Prisma identicas (where/select/include/orderBy/take). Unico desvio: ordem das chaves em where de tarefas ({userId,status,dueDate} vs {userId,dueDate,status}); irrelevante em toEqual/Prisma.
- Filtro de pendentes unico (open-tasks.filter) usado nos 3 usos (count hoje, findMany hoje, atrasadas). Strings do enum TaskStatus/TransactionType = valores originais.
- Ordem das chamadas Prisma/servicos preservada (user, task.count, task.findMany, overdue, groupBy, ..., insights, forecast, 5 findFirst); todas disparadas juntas (resolveAll = Promise.all). findUniqueOrThrow do usuario 2x.
- Janelas, monthToDateUtc(now, timezone), materializacao antes do cache, del so se criou algo, cache hit sem consulta, setJson no fim, saldo assinado, Number/null, chaves e ordem do JSON, invalidateSummary: iguais.
- Callers (controller, assistant, conversation, life-engine) fazem cast `as`; tsc sem erro em src/dashboard (e assistant/conversation/life-engine).
- Snapshot: untracked, sem git log possivel. Prova: spec de caracterizacao PASSA contra o service ORIGINAL (HEAD) e contra o novo. Gaps spec tambem passa no original (com diagnostics off; original e untyped).
- Tamanhos: todos os arquivos <=119 linhas, funcoes <=20 linhas. Sem duplicacao relevante.

## Mutantes (58)
- Mortos pelos testes originais: 41 (comparadores, take, orderBy, status, isRead, recurringId, sinal, Number, troca de totais, del, setJson, janela, cache...).
- Mortos por erro de compilacao (ts-jest, 0 testes): 4 (ACHIEVED->CANCELLED, tx sem Number, estimatedAmount->toNumber, ...).
- Sobreviventes (8) -> testes novos em dashboard.summary.gaps.spec.ts (76 linhas), todos mortos: select de transactions sem category, select de goals sem description, orderBy dos lembretes, `?? 0` removido, undefined em toNullableNumber, onboarding selah<->goals (fakes eram iguais), ordem de chaves do JSON, fuso do mes (UTC vs Sao_Paulo).
- Equivalentes: nenhum.

## Defeitos
Nenhum no codigo refatorado. Lacunas apenas de teste (acima).

## Execucao
- TZ UTC / America/Sao_Paulo / Asia/Tokyo: 21/21 verdes.
- 15x em UTC: 0 falhas.
- tsc --noEmit | grep ^src/dashboard: vazio.
- Arquivos restaurados apos cada mutante (diff igual ao inicial; unica adicao: gaps spec).

## NAO verificado
- Prisma real / banco real (fakes).
- eslint (config nao achou src/dashboard como padrao).
- Integracao do controller HTTP.
- Snapshot nao tem prova de data via git (so equivalencia contra HEAD).
