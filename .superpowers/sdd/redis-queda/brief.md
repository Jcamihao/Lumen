# Brief: Redis que cai com o backend no ar (branch fix/redis-queda-backend)

## Problema (confirmado lendo o codigo)
backend/src/cache-queue/cache-queue.service.ts:
- isAvailable vira true no boot e NUNCA volta a false. Se o Redis cair depois, getJson/setJson/del/hitRateLimitWindow/invalidateByPrefix/enqueue continuam chamando o ioredis.
- O cliente usa maxRetriesPerRequest: null (e fila offline padrao): o comando fica enfileirado para sempre, a requisicao pendura. Afeta RateLimitGuard (login, webhook WhatsApp, etc.), DashboardService (cache), LifeEngineService (enqueue/del) e o webhook do WhatsApp.
- Se o Redis esta fora no boot, nunca reconecta (isAvailable fica false pra sempre).
- Sem listener de 'error' no cliente.

## Comportamento desejado
1. Cliente de cache: enableOfflineQueue: false, maxRetriesPerRequest: 1, commandTimeout curto (1500 ms), retryStrategy com backoff (ex.: min(times*200, 5000)) para reconectar sozinho. Mantenha lazyConnect e a conexao inicial sem derrubar o boot.
2. Estado de disponibilidade acompanha eventos do cliente: 'ready' -> true (log unico "Redis reconectado"); 'close'/'end'/'error' -> false (log unico por transicao, SEM texto de erro com dados; so o nome do erro). Sem spam de log a cada tentativa.
3. Cada metodo publico (getJson, setJson, del, hitRateLimitWindow, invalidateByPrefix, enqueue) envolve a chamada em try/catch: erro ou timeout => mesmo retorno do modo degradado (getJson null; setJson/del/invalidateByPrefix no-op; hitRateLimitWindow null; enqueue no-op), log warn sem dados do usuario, e marca indisponivel se for erro de conexao. NUNCA propagar excecao nem pendurar. JSON.parse invalido no getJson tambem retorna null.
4. enqueue: a criacao/uso do Queue do BullMQ tambem nao pode pendurar: limite de tempo (Promise.race com 2000 ms) e catch.
5. hitRateLimitWindow: INCR + PEXPIRE + PTTL devem ficar atomicos o bastante: se o INCR der certo e o PEXPIRE falhar, a chave ficaria sem expiracao. Use um unico multi/pipeline ou script Lua (EVAL) que faz INCR, PEXPIRE se hits==1 (ou se pttl<0) e devolve hits e pttl. Se falhar => null.
6. NAO mudar: assinaturas publicas, RateLimitGuard (ja cai para memoria quando recebe null), a regra do WhatsApp de falha fechada sem Redis (null => numero sem vinculo fica mudo). Nao alterar outros modulos alem de cache-queue (e seus testes). Se achar que precisa, anote em duvidas.md e pare.
7. onModuleDestroy: nao pode pendurar se o Redis estiver fora (quit com tolerancia; use disconnect() em caso de erro) e deve fechar as filas sem lancar.

## Testes (jest, backend/src/cache-queue/cache-queue.service.spec.ts, novo)
Mock de 'ioredis' e 'bullmq'. Casos minimos: (a) Redis ok: cache e rate limit funcionam; (b) cliente emite 'close' -> isReady false e todos os metodos retornam rapido o valor degradado sem chamar o cliente; (c) emite 'ready' -> volta a funcionar; (d) comando que rejeita -> degradado, sem excecao; (e) comando que nunca resolve -> degradado dentro do limite de tempo (jest fake timers); (f) boot com connect rejeitando -> sem excecao, isReady false, e depois de 'ready' passa a funcionar; (g) INCR ok e PEXPIRE falho nao deixa chave sem TTL (conforme a estrategia escolhida); (h) enqueue pendurado -> volta dentro do limite; (i) onModuleDestroy com Redis fora nao pendura; (j) log nao contem a URL do Redis nem a senha.
Rode: cd backend && npx tsc --noEmit && npx jest src/cache-queue src/common/guards src/whatsapp --maxWorkers=2 (NUNCA 8 jest em paralelo, ja reiniciou o WSL).

## Regras
- Comentarios e logs em portugues sem acentos (padrao do codigo). Sem dependencia nova.
- Commits separados com caminhos explicitos, Conventional Commits em portugues, nunca amend/reset. Nao faca push. Nao toque em .env, portas ou containers de outros projetos.
- Termine escrevendo .superpowers/sdd/redis-queda/resultado-impl.md (o que mudou, comandos rodados, numeros, o que NAO verificou).
