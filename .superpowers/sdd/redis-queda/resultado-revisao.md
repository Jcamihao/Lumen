# Revisao: Redis que cai com o backend no ar

Data: 2026-11-19. Revisor: claude-sonnet-5-5 (conferencia independente; implementacao foi do haiku). Branch fix/redis-queda-backend.

## Veredito
APROVADO COM CORRECAO. A implementacao original resolvia queda com close/error, mas tinha um defeito real (a) que foi corrigido em 79149c1 (teste em dd37a19 e um commit de teste adicional). Sem push, sem merge.

## Achados
- (a) REAL, corrigido. Com Redis pendurado (docker pause, conexao aberta) nenhum evento close vem: o status ficava up e toda requisicao pagava 1,5 s (enqueue 2 s), com um warn por requisicao. Medido antes da correcao: 1534 a 3042 ms por requisicao. Correcao: breaker. 2 timeouts seguidos => status down; depois, uma unica sonda a cada 5 s (as demais chamadas voltam na hora com o valor degradado); sonda ok => up com log "reconectado"; close/end/erro de conexao cancelam a sonda e quem religa e o ready do ioredis. Sonda que falha nao loga. Depois: 2 requisicoes lentas (1,5 s), o resto em 30 a 40 ms, retorno automatico.
- (b) OK. Queue criado com Redis no ar e mantido em this.queues volta a funcionar depois de stop/start do Redis (2 jobs enfileirados apos reconectar). Queue criado apos boot com Redis fora tambem (enqueue so cria Queue com status up). Observacao aceita: se o enqueue estourar o limite de 2 s, o queue.add continua pendente em segundo plano e o job pode entrar depois da volta do Redis; o chamador ja recebeu no-op. Com enqueue no-op em modo degradado o job se perde (aceito pelo brief).
- (c) OK. hitRateLimitWindow null: RateLimitGuard cai para memoria (provado na app: rota com guard responde 200 em ~35 ms com Redis fora/pausado e volta ao Redis depois; chave rate-limit com PTTL ~59,6 s). WhatsApp: com rate null, numero vinculado segue (findUserIdByJid), sem vinculo fica mudo (falha fechada), link-code com attempts null retorna sem resgatar. Conforme brief.
- (d) OK. Script Lua usa uma unica chave (KEYS[1]), compativel com cluster. Verificado em Redis real que chave existente sem TTL recebe PEXPIRE (6 / 60000) e que a versao sem ttl<0 deixa -1.
- (e) OK. Logs so com codigo/nome do erro; teste (j) cobre URL/senha/host. Observado nos logs reais: so ECONNREFUSED, "conexao fechada", "timeouts seguidos". Fila loga em debug o codigo do erro a cada ~1 s enquanto Redis fora (nivel debug, sem dado; aceito).
- Teste (e) existente foi ajustado: apos dois timeouts o status agora e down.

## Mutantes (servico, spec com 25 testes)
Rodada com 20 + 3 refeitos (M3, M13 reancorados) + M16 depois do teste novo.
- Mortos (19): close sem down, ready sem up, sem timeout, sem try/catch, streak 3, streak sem reset, sonda sem reagendar, sem trava de sonda unica, sonda ignora intervalo, close sem cancelar sonda, sonda ok sem up, log sem dedupe, INCR solto no lugar do eval, timeout nao conta, JSON sem parse, enqueue 5000 ms, sem disconnect, log por sonda (M16, morto pelo teste novo), M3.
- Sobrevivente real tratado: M16 (sonda logando warn) -> teste novo.
- Sobrevivente por limite do mock: M14 (Lua sem ttl<0); morto contra Redis real (-1 vs 60000).
- Equivalente/sem efeito pratico: M17 (closing nao bloquear sonda): depois do destroy o cliente e null, a janela e so durante o fechamento das filas.

## Integracao real (Redis 7 descartavel rv-redis-review, 127.0.0.1:16390; app Nest de bootstrap fora do repo com CacheQueueModule + RateLimitGuard + rotas de teste, porta 16391)
- Boot ok: cache, rate limit e enqueue ok (~35 a 85 ms).
- pause: antes da correcao 1,5 a 3 s por requisicao; depois, 2 requisicoes de 1,5 s e o resto 30 a 40 ms; sonda de 5 s (1,5 s) e retorno ao Redis apos unpause em 1 sonda.
- stop: degradado em ms; start: reconexao automatica, 1 log por transicao; rate limit voltou ao Redis; enqueue funcionando (jobs na lista wait).
- Boot com Redis fora: app sobe em 75 ms, rotas rapidas, reconecta sozinha quando o Redis sobe.
- Shutdown (SIGTERM) com Redis fora: processo encerrou em ~1,3 s.
- Limpeza: container removido, portas 16390 a 16392 sem listener. Nenhum container de outros projetos foi tocado.

## Numeros (2026-11-19, conferido pelo revisor)
- npx tsc --noEmit: sem erros.
- jest src/cache-queue src/common/guards src/whatsapp src/dashboard src/life-engine --maxWorkers=2: 12 suites, 163 testes verdes.
- src/cache-queue 15 rodadas seguidas: 15/15 (25 testes cada).

## NAO verificado
- DashboardService e LifeEngineService com o servico real sob queda (so unit com mock do servico).
- DashboardService nao entrou no bootstrap de integracao.
- Redis com senha/TLS/cluster/sentinel (so sem senha em localhost).
- Carga concorrente com Redis pendurado (varias requisicoes simultaneas antes do breaker armar pagam 1,5 s cada; nao medido).
- Worker do BullMQ consumindo os jobs enfileirados (so conferi a lista wait).
- Teste de fuso: sem logica de data.
- O harness de integracao ficou fora do repo.
