# Brief 9a-3: tres decisoes do dono sobre a revisao da 9a (branch feat/varios-cartoes)

Leia: CLAUDE.md e .superpowers/sdd/varios-cartoes-9a/resultado-revisao-9a.md (achados 2, 3 e 4 sao o seu escopo). O dono decidiu em 2026-11-23 ("sim nos 3"). Docker esta LIGADO, mas voce NAO precisa dele: teste com mocks como nos specs existentes. NAO use nem toque nos containers lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306.

## Mudancas
1. **Clamp no backfill** (backend/prisma/migrations/20261123120000_credit_cards/migration.sql): ao criar o "Principal", closingDay = LEAST(31, GREATEST(1, monthClosingDay)); dueDay = NULL se creditDueDay for NULL, senao LEAST(31, GREATEST(1, creditDueDay)). Comentar no SQL por que (dado antigo fora da faixa 1..31). A migration ainda nao foi aplicada em nenhum ambiente real, entao editar e permitido; NAO crie migration nova. Nao mude mais nada na migration.
2. **Receita com cartao**: criar/atualizar lancamento (transactions), e onde houver DTO equivalente em parcelado/recorrencia, recusa cardId quando type=INCOME com 400 e mensagem em portugues ("Cartao so se aplica a despesa."). Na atualizacao, se o tipo mudar para INCOME e houver cardId gravado, limpe o cardId (null) como ja se faz ao sair de CREDIT; se o corpo mandar cardId junto com INCOME, 400. Mantenha a ordem de locks existente.
3. **Filtro cardId na listagem de lancamentos**: o filtro do cartao PADRAO do dono passa a incluir tambem lancamentos CREDIT com cardId nulo (OR cardId = id OR (cardId IS NULL AND paymentMethod = CREDIT)), igual a regra de gasto do ciclo (reuse o helper de escopo de gasto do credit-cycle em vez de duplicar). Cartao secundario continua so cardId = id. Cartao alheio continua 404. Isolamento: o userId do token SEMPRE entra no where, antes de qualquer OR (cuidado com precedencia: AND userId, depois o OR).

## Testes (jest, no maximo 2 workers)
- Migration SQL: nao ha teste automatizado; descreva no resultado como conferir (valores 0, 40, -3, NULL).
- Servico: INCOME+cardId = 400 (criar e atualizar), mudar para INCOME limpa cardId, EXPENSE+CREDIT+cardId continua ok.
- Filtro: padrao inclui nulos CREDIT e NAO inclui nulos PIX/DEBIT nem cardId de outro cartao; secundario nao inclui nulos; usuario B nunca aparece na lista de A (isolamento A/B/C); cartao alheio 404.
- Mutantes: >= 8 (remover userId do where, trocar AND/OR, incluir nulos no secundario, nao recusar INCOME, nao limpar ao virar INCOME, incluir nulos PIX no padrao etc.), registre mortos/sobreviventes/equivalentes e cubra os sobreviventes.
- Rode: cd backend && npx tsc --noEmit && npx jest src/credit-cards src/credit-cycle src/transactions src/installments src/recurring-transactions src/insights src/conversation src/users --maxWorkers=2 em TZ=UTC, America/Sao_Paulo e Asia/Tokyo; depois a suite inteira uma vez (--maxWorkers=2).

## Regras
- Comentarios em portugues sem acentos no codigo. Sem dependencia nova. Nao mude contrato de resposta existente.
- Commits separados com caminhos explicitos (migration; income; filtro; testes; docs), Conventional Commits em portugues, com Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>. Nunca amend/reset/push. index.lock: espere e repita.
- Depois do codigo: graphify update . na raiz.
- Termine com .superpowers/sdd/varios-cartoes-9a/resultado-9a3.md (mudancas, comandos e numeros, mutantes, NAO verificado). Se parar por limite, diga onde parou. Nao pergunte nada.
