# Resultado da implementacao: Redis que cai com o backend no ar

Data: 2026-11-19 (18:13 -03:00). Branch: fix/redis-queda-backend.
Executado por claude-haiku-5-5 (agente principal, sem subagente). Conferencia independente: nao houve revisor separado; os numeros foram refeitos pelo agente principal.

## O que mudou

- backend/src/cache-queue/cache-queue.service.ts (reescrito, assinaturas publicas iguais):
  - Cliente com enableOfflineQueue false, maxRetriesPerRequest 1, commandTimeout 1500 ms, retryStrategy min(times*200, 5000), lazyConnect. Boot nao espera a conexao.
  - Disponibilidade por eventos: ready -> up; close, end, error -> down. Log uma vez por transicao; "Redis reconectado" ao voltar. Motivo do erro so por codigo ou nome, nunca mensagem.
  - Todo metodo publico passa por runCommand: limite de tempo, catch, valor degradado. Erro de conexao (codigo ou mensagem) derruba o status. JSON invalido no getJson devolve null.
  - hitRateLimitWindow usa um script Lua unico (INCR, PTTL, PEXPIRE se hits==1 ou ttl<0). Falha devolve null.
  - enqueue: limite de 2000 ms e listener de erro na fila.
  - onModuleDestroy: fecha filas e o cliente com limite de 1000 ms; disconnect se o quit falhar; nunca lanca.
  - URL invalida: boot segue em modo degradado sem criar cliente.
- backend/src/cache-queue/cache-queue.service.spec.ts (novo): 18 testes, mocks de ioredis e bullmq, casos (a) a (j) do brief mais d2, i2, i3, k e configuracao do cliente.
- Nao alterado: RateLimitGuard, regra do WhatsApp, demais modulos. Unica acao fora do repo: prisma generate (regenera node_modules/.prisma, nao versionado).

## Comandos e numeros

- npx jest src/cache-queue --maxWorkers=2: 18/18 verdes.
- npx jest src/cache-queue src/common/guards src/whatsapp --maxWorkers=2: 10 suites, 137 testes, todos verdes (2026-11-19).
  - Antes do prisma generate, 4 suites de whatsapp nao compilavam (PrismaService sem whatsappLink, client desatualizado). Nao era deste trabalho; resolvido regenerando o client.
- Flakiness: 15 rodadas seguidas de src/cache-queue, 15/15 verdes.
- npx tsc --noEmit: 3 erros restantes, todos fora da area tocada (src/imports/receipt-readers.ts: modulos sharp e tesseract.js ausentes em node_modules). Nao verifiquei isso em HEAD isoladamente. O brief encadeia tsc com && e por isso nao passa como esta.
- graphify update . executado (graphify-out fica no .gitignore).

## Integracao real (Redis 7 em container descartavel)

Container redis:7-alpine na porta 127.0.0.1:16379 (porta conferida livre antes). Cenario com pause, stop, start e boot com Redis fora:
- Boot com Redis ok: ready em menos de 1 s; cache, rate limit (hits 1, 2; PTTL > 0) e enqueue ok.
- docker pause: getJson e rate limit devolvem null em ~1500 ms; enqueue em ~2000 ms. Sem pendurar.
- Unpause: getJson volta com o valor.
- docker stop: isReady false em menos de 1 s; chamadas degradadas em 0 ms.
- docker start: reconecta sozinho, log "Redis reconectado" uma vez, cache volta.
- Boot com Redis fora: retorna em 0 ms, ready false; depois de docker start reconecta sozinho.
- onModuleDestroy com Redis fora: 1 ms.
- Container removido com docker rm -f; ss confirma porta 16379 sem listener.

## Revisao com mutantes (servico, spec)

Rodada 1, 20 entradas: 16 mortas, 3 sobreviventes, 1 controle.
- Mortos: M01 offline queue ligada; M02 close ignorado; M03 ready nao marca up; M04 sem limite de tempo; M05 erro propagado; M06 erro de conexao so por codigo; M08 limite do enqueue 1500; M09 sem disconnect; M10 log de reconexao errado; M11 motivo com mensagem; M12 sem dedupe de transicao; M13 connect aguardado no boot; M16 resetAfterMs ignora TTL; M17 JSON sem parse; M18 fallback undefined; M19 checagem de status removida.
- Sobreviventes: M07 (ttl<0 no Lua, mock nao executa Lua), M14 (clearTimeout removido), M15 (flag closing removida).
- M20 foi um controle sem mutacao, nao conta.

Rodada 2 (depois de incluir os testes k e i):
- M14 e M15 mortos (1 falha cada).
- M07 nao morto pelo spec (mock). Morto contra Redis real: com chave sem TTL, o script original corrige para 60000 ms; a versao mutante deixa -1. Verificacao manual, fora do spec.

Equivalentes: nenhum identificado.

## NAO verificado

- Enqueue depois de reconectar: testado so o pendurar (pause) e o boot; nao testei enqueue apos docker start.
- Fila do BullMQ com maxRetriesPerRequest null: segue reconectando por conta propria em background. Nao medi isso.
- Carga real (muitas requisicoes com Redis caido) e comportamento do RateLimitGuard com o servico real: so via unit com mock.
- Teste de fuso (TZ) nao se aplica: nao ha logica de data no cache-queue.
- Falha no meio de transacao (queda no meio de commit): nao aplicavel aqui.
- Redis em cluster ou com senha/TLS: testado so sem senha e em localhost.
- Cenario de integracao real ficou em temporarios fora do repo; nao foi versionado.
