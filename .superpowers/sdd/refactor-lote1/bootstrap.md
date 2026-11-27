# Revisao: refactor lote 1 (bootstrap + bill-reminder)

Data: 2026-11-27. Conferido por: Claude Sonnet 5.5 (revisor independente). Commits revisados: 8770b69, e5acb79, 20671cf.

## Veredito
Sem mudanca de comportamento. Nenhum defeito real encontrado.

## Conferencia linha a linha (main.ts original vs src/bootstrap/*)
Ordem original e nova identicas: trust proxy 1, shutdown hooks, prefixo api/v1, rastreio de requisicao, CORS, json (5mb, rawBody so no webhook WhatsApp), urlencoded (5mb), helmet, compression, ValidationPipe (whitelist, transform, forbidNonWhitelisted, implicit conversion), filtro global, Swagger (so se app.swaggerEnabled; path api/docs). CORS: !origin ou lista, credentials true, sem Error. Log: >=500 error, >=400 warn, senao log. Porta/host/appUrl com os mesmos padroes. main.ts chama bootstrap() ao carregar, como antes.
Observacao (preexistente, preservada): helmet/compression vem DEPOIS dos parsers, nao antes.
Swagger: controlado so por config, nao por NODE_ENV (igual ao original).

## bill-reminder
Mesma consulta (where, orderBy, select), janela 3 dias, filtros em JS, mapeamento, tratamento de erro (warn + false), skipped => false, marca so apos envio. DI e consumidores inalterados (modulo, workers). Tamanhos: arquivos <=120 linhas (service 119), funcoes <=20.

## Mutantes (46)
Mortos: 43. Sobreviventes: 3 (2 mortos depois por teste novo, 1 equivalente). Todos revertidos; git status limpo.
Mortos: ordem (cors/tracing, helmet/parsers, validacao/helmet, prefixo/tracing), shutdown hooks, trust proxy, prefixo, limite de corpo, path do webhook, CORS aberto, sem !origin, sem credentials, Error em origem ruim, helmet off, compression off, whitelist, forbidNonWhitelisted, transform, implicit conversion, Swagger sempre/nunca/path, limiar 400, limiar 500, requestId sem trim, sem header de resposta, userId anonymous, filtro removido, janela 3->4, gt->gte, lte->lt, tipo INCOME, isActive removido, orderBy desc, endDate >= -> >, lastReminder !== -> ===, skipped invertido, catch devolvendo true, amount sem Number, sem marcar, data marcada errada, sem checagem de elegibilidade, userId removido do where, main.ts sem bootstrap() (16 falhas).
Sobreviventes mortos: DEFAULT_PORT 3000->3001 e DEFAULT_HOST 0.0.0.0->127.0.0.1 (teste novo bootstrap-settings.spec.ts).
Equivalente: Math.round -> Math.floor em daysUntil. nextDueDate e userToday sao datas UTC a meia-noite, diferenca e multiplo exato de DAY_MS.

## Verde (28 -> 31 testes, 3 suites)
TZ=UTC, America/Sao_Paulo, Asia/Tokyo: 31/31. 15 execucoes seguidas em UTC: 15/15. `npx tsc --noEmit`: vazio.

## NAO verificado
Subida real do servidor (HTTP real, CORS/helmet em runtime); testes usam mocks de NestFactory. Suite completa do backend. graphify update.
