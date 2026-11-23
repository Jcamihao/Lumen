# Brief de revisao curta: 9a-3 + merge da develop (branch feat/varios-cartoes)

Voce e o REVISOR (sonnet). Leia CLAUDE.md, .superpowers/sdd/varios-cartoes-9a/{resultado-9a3,resultado-revisao-9a}.md e o contrato docs/superpowers/specs/2026-11-23-conversa-contrato-item-9.md. Decisoes do dono (2026-11-23, "sim nos 3"): clamp 1..31 no backfill; receita (INCOME) recusa cardId com 400; filtro do cartao padrao inclui CREDIT com cardId nulo.
Escopo: git diff 3c1bf5c..HEAD (9a-3: migration clamp, income, filtro) e o merge da develop (commit de merge): em backend/src/transactions/transactions.service.ts o update() agora junta o item 8a (expectedUpdatedAt, trava FOR NO KEY UPDATE na linha do lancamento) com o cardId do item 9 (trava do User primeiro). Item de isolamento/concorrencia: foque nele.

## Verificar (REAL, Docker ligado)
- Conteineres descartaveis (docker run --rm) SO com nomes rv9b-*, portas livres conferidas com ss -ltn, Postgres 16 + Redis 7. NUNCA toque em lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000.
- Banco limpo com todas as migrations; backend nest build em porta propria; contas A, B, C.
- Receita + cardId = 400 em criar e atualizar (transactions, e parcelado/recorrencia onde aplicavel); virar INCOME limpa cardId gravado; despesa CREDIT com cardId continua ok.
- Filtro cardId: padrao traz CREDIT nulos e NAO traz PIX/DEBIT nulos; secundario so o seu; A nunca ve lancamentos de B (com e sem filtro); cartao alheio 404.
- Concorrencia/deadlock no update() mesclado: (1) update com expectedUpdatedAt SEM mexer em cartao vs make-default/PUT ceiling simultaneos; (2) update com expectedUpdatedAt E cardId/paymentMethod/type (caminho com lock do User) em paralelo com outro update do mesmo lancamento sem expectedUpdatedAt; (3) dois updates com expectedUpdatedAt iguais em paralelo (um grava, o outro 409). Confirme ausencia de deadlock (timeouts) e de gravacao dupla. Confira tambem que a edicao por conversa (item 8a, src/conversation) continua verde.
- Clamp: aplique as migrations ate 20261119120000_ai_fallback_outcomes, insira users com monthClosingDay 0, 40, -3 e creditDueDay NULL, 0, 45, 10 e aplique a 20261123120000 (o dono/agente principal ja conferiu 4 casos; confira tambem countAllPayments e tetos).
- Injete >= 10 mutantes proprios nas 3 mudancas e no update() mesclado (registre mortos/sobreviventes/equivalentes; teste os sobreviventes reais).

## Entrega
- Corrija DEFEITOS com commits separados (fix(...) em portugues, Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>), sem amend/reset/push. Duvida de produto vai para o relatorio.
- Ao terminar: remova TODOS os conteineres/arquivos temporarios seus, confirme portas sem listener e que os conteineres do dono seguem de pe. Rode tsc e a suite inteira com --maxWorkers=2 (NUNCA mais de 2 workers) e graphify update . na raiz.
- Escreva .superpowers/sdd/varios-cartoes-9a/resultado-revisao-9a3.md: veredito, achados, mutantes, verificacoes reais com numeros, NAO verificado. Se parar por limite de uso, diga onde parou.
