# Revisao da refatoracao do lote 1: life-workers e forecasts

Data: 2026-11-27. Conferido por: Claude Sonnet 5.5 (revisor), worktree /tmp/claude-1000/wt-refactor-lote1.
Original: `12252a7~1` (life-workers.service.ts 486 linhas, forecasts.service.ts ~230 linhas).

## Veredito
Comportamento preservado. Nenhum defeito funcional encontrado. Um defeito de estilo (funcoes > 20 linhas em forecasts/calculation) corrigido.

## Conferencia linha a linha
- Filas: REMINDERS, INSIGHTS, FORECASTS, PULSE_SCAN, nessa ordem, cada Worker com `{ connection }`. Igual.
- Ciclo de vida: guarda Redis (isReady e connection), aviso "Workers desativados...", bootstrap de lembretes, schedulePulseScan, depois workers; destroy fecha todos com Promise.all. Igual.
- Lembrete: busca com os mesmos include/select; so dispara se SCHEDULED; update SENT+sentAt; notificacao REMINDER; e-mail dentro de try (elegibilidade tambem), erro engolido com log `reminder_email_failed`. Igual.
- Insights: refresh, notificar pendentes (titulo por persona), escalada. Ordem igual. Escalada: mesmas consultas, e-mail com erro engolido por insight, updateMany escalatedAt sempre (mesmo sem elegibilidade), log. Igual.
- Forecast: HIGH notifica FORECAST. Igual.
- Pulse scan: materializa recorrentes e parcelas para todos (erro engolido, label `recurring_materialize_failed`/`installments_materialize_failed`), filtra por hora local, processa aporte, touch, resolveMatureSnapshots (propaga), bill reminder (engolido), digest. Resumo logado so se touched > 0. Unica diferenca: `touched` agora incrementa ao fim do usuario (antes, antes de resolveMatureSnapshots); se algo propaga, o scan aborta nos dois casos sem log. Sem efeito observavel.
- Aporte de meta: `day < 1` retorna 0, dia local 1 funciona, mesma query, update, transaction TRANSFER, notificacao, log. Continua nao atomico (update, create e notificacao sem transacao), exatamente como no original. Limitacao herdada, nao introduzida.
- Digest: findUnique, inelegivel avanca lastWeeklyDigestAt e retorna false, sucesso envia e marca, erro engolido com log. Igual.
- Fuso: Intl en-US, fallback -1/false em fuso invalido. Igual.
- Logs: contexto `LifeWorkersService` via workerLogger. Igual.
- Forecast: janela (agora, +30 dias, inicio do dia), mesmas 4 consultas em Promise.all na mesma ordem, saldo/fluxo/custos, renda projetada, risco (HIGH: saldo<0 ou exposicao>=renda; MEDIUM: saldo<25% renda ou exposicao>=60% renda), Forecast + Snapshot criados, retorno com Number. Igual. Observacao: o limiar de exposicao MEDIUM e 0,6 (nao 0,5), e foi preservado.
- DI e consumidores: construtor de LifeWorkersService e ForecastsService inalterados; consumidores (life-engine.module, forecasts.module/controller, dashboard.service, summary-sources.type, spending-analysis) sem mudanca.

## Tamanho e design
- Todos os arquivos <= 120 linhas (reminder-dispatch.processor.ts = 120).
- Defeito corrigido (commit 8885e05): loadForecastInputs (47), calculateForecast (34) e persistForecast (33) passaram de 20 linhas. Agora cada funcao tem corpo <= 20 (helpers findCurrentTransactions, findFutureTransactions, findPendingCostTasks, projectMonthlyIncome, createSnapshot). Snapshots seguem verdes.
- Construtores com lista longa de parametros (ate 26 linhas contando a assinatura) sao so injecao de dependencias.
- Acoplamento: processors sao classes simples (sem decorator), montadas no construtor de LifeWorkersService; so ele fala com Nest/BullMQ. Aceitavel.

## Mutantes (60)
Resultado: 47 mortos pela suite original, 10 mortos por testes novos, 3 equivalentes. Todos revertidos; git status limpo.

Sobreviventes da suite original e como foram mortos (novos: life-workers.survivors.spec.ts, forecasts.boundaries.spec.ts):
- guarda `status === SCHEDULED` do lembrete removida
- ordem notificar pendentes antes de escalar trocada
- erro de e-mail da escalada propagando
- log do pulse mesmo com touched = 0
- aporte `>=` virando `>` (meta igualada ao alvo)
- transacao sem linkedGoalId
- erro do digest propagando (sem log/sem avanco)
- piso de risco 0,25 virando 0,3
- saldo previsto exatamente 0 virando HIGH (`<=`)
- `targetDate: { lte }` virando `lt` na resolucao de snapshots

Mortos pela suite original (amostra): nome de fila, ordem de registro, destroy sem close, sem bootstrap, sem schedulePulseScan, guarda Redis, e-mail sem elegibilidade, erro de e-mail propagando, escalada (guarda, mark, lte/gte, 3 dias), HIGH, hora padrao 7, filtro de hora, materialize >0, erro engolido propagando (materialize, bill, bootstrap), ordem de materializacao, segunda-feira, daysSince null, limite 6 dias, `day < 2`, recurringDay, alvo nulo, markDigestSent (2x), contexto de log, bootstrap gt/lt, horizonte 30/31, startOfDay, exposicao >=, 0,6, sinal, erro 100/abs, Math.abs, remainingDays, sem snapshot, targetDate, status de tarefas, guarda due=0, resolvedAt.

Equivalentes (3):
- `parseInt(hour) % 24` removido: Node 24 (ICU) devolve "00" a meia-noite com hour12:false, entao o modulo so protege runtimes antigos que devolvem "24". Teste de meia-noite adicionado como guarda.
- `day < 1` virando `day < 0`: dia 0 nao existe; o fallback e -1, ambos retornam 0.
- `monthlyIncome > 0` virando `>= 0` na renda projetada: com renda 0 o resultado e 0 de qualquer forma.

## Execucao (2026-11-27)
- `npx jest src/life-engine src/forecasts`: 11 suites, 62 testes, 60 snapshots verdes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo.
- 15 execucoes seguidas em UTC: 15/15 verdes.
- `npx tsc --noEmit | grep -E '^src/(life-engine|forecasts)'`: vazio.

## NAO verificado
- Integracao real com Redis/BullMQ e Postgres (tudo com fakes; bullmq mockado).
- Suite completa do backend fora de life-engine e forecasts.
- Atomicidade do aporte de meta (nao existe, nem no original).
- Concorrencia/opcoes de Worker alem de `{ connection }` (o original nao define outras).
