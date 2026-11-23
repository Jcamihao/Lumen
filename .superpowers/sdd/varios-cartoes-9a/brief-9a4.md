# Brief 9a-4: filtro do cartao padrao so com despesa (branch feat/varios-cartoes)

Decisao do dono (2026-11-23, "sim"): o filtro por cardId do cartao PADRAO, na parte que inclui lancamentos CREDIT com cardId nulo, deve incluir so DESPESA (type EXPENSE). Receita CREDIT sem cartao nao entra. Isso alinha a lista ao gasto do ciclo, que so soma despesa.

## Escopo (pequeno)
- backend/src/credit-cycle/credit-cycle.util.ts: cardScopeWhere: no ramo do padrao, { cardId: null, paymentMethod: 'CREDIT', type: 'EXPENSE' }. Atualize o comentario. Cartao secundario nao muda. Confira os usos (transactions.service.ts list; helper do gasto do ciclo em credit-cycle.service.ts e insights) para ver que o gasto do ciclo continua igual (ele ja filtra EXPENSE) e ajuste os testes que comparam o where exato.
- Testes: padrao inclui EXPENSE CREDIT nulo; NAO inclui INCOME CREDIT nulo; NAO inclui PIX/DEBIT nulo; secundario nao inclui nulos; isolamento A/B/C do filtro intacto (userId sempre AND). Se for gerar mocks de where, mantenha o padrao dos specs existentes.
- Mutantes (>= 5): tirar o type do filtro; trocar EXPENSE por INCOME; tirar paymentMethod; tirar o OR; incluir nulos no secundario. Registre mortos/sobreviventes/equivalentes e cubra os sobreviventes.
- Rode: cd backend && npx tsc --noEmit && npx jest src/credit-cycle src/credit-cards src/transactions src/insights src/conversation --maxWorkers=2 em TZ=UTC, America/Sao_Paulo e Asia/Tokyo; depois a suite inteira (--maxWorkers=2) uma vez; graphify update . na raiz.

## Regras
- Comentarios em portugues sem acentos no codigo. Nao mude schema nem migration. NAO use nem toque nos containers lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects.
- Commits separados com caminhos explicitos (fix; test; docs), Conventional Commits em portugues, com Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>. Nunca amend/reset/push.
- Termine com .superpowers/sdd/varios-cartoes-9a/resultado-9a4.md (mudancas, comandos e numeros, mutantes, NAO verificado: nao ha integracao em Postgres real nesta fatia). Nao pergunte nada.
