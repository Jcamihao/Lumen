# Resultado 9a-3: decisoes do dono sobre a revisao da 9a

Data: 2026-11-23. Executor: Claude Haiku 5.5 (haiku), agente principal, sem subagentes. Branch feat/varios-cartoes.
Brief: .superpowers/sdd/varios-cartoes-9a/brief-9a3.md. Base: ab9b392.

## Veredito
Os 3 itens do dono foram implementados e testados (unit com mocks, como os specs existentes). Migration corrigida mas NAO
aplicada em banco real. Revisao independente (sonnet) NAO feita: ver NAO verificado.

## Commits (sem push, sem amend/reset)
- 1309b82 fix(credit-cards): clamp dos dias no backfill do cartao Principal (migration.sql)
- 94b0314 fix(transactions): receita nao aceita cartao (card-link.ts, recurring-transactions.service.ts, transactions.service.ts)
- 0f8011d feat(transactions): filtro do cartao padrao inclui CREDIT sem cartao (credit-cycle.util.ts, transactions.service.ts)
- 7ab0f14 test(credit-cards): receita sem cartao, escopo do filtro e shape do ciclo (6 specs, 1 novo)
- este commit: docs (este relatorio)

## Mudancas
1. **Clamp no backfill** (migration 20261123120000_credit_cards, sem migration nova): closingDay = LEAST(31, GREATEST(1, monthClosingDay));
   dueDay = NULL se creditDueDay for NULL, senao LEAST(31, GREATEST(1, creditDueDay)). CASE porque LEAST/GREATEST ignoram NULL
   no Postgres (GREATEST(1, NULL) = 1). Comentario no SQL explica o motivo.
2. **Receita com cartao**: criar lancamento ou conta fixa com cardId e type=INCOME = 400 "Cartao so se aplica a despesa.",
   antes de checar a forma de pagamento. Editar: cardId no corpo com INCOME = 400; virar INCOME limpa o cardId gravado (null), sob o lock.
   cardLock do update de lancamento agora tambem inclui dto.type. Conta fixa: o tipo vem do registro gravado (lido sob o lock).
   Parcelado (installments) nao tem campo type (sempre despesa): nada a recusar la.
3. **Filtro cardId na listagem**: cardScopeWhere(card) em credit-cycle.util.ts, usado pela listagem e pelo cardSpendWhere do ciclo
   (uma regra so). Padrao: OR [cardId = id, cardId NULL AND paymentMethod CREDIT]. Secundario: cardId = id. userId fica AND no where,
   fora do OR. Alheio e inexistente seguem 404 com a mesma mensagem.

## Comandos e numeros (2026-11-23)
- cd backend && npx tsc --noEmit: exit 0.
- Escopo (src/credit-cards src/credit-cycle src/transactions src/installments src/recurring-transactions src/insights src/conversation src/users, --maxWorkers=2):
  TZ=UTC 1043/1043, America/Sao_Paulo 1043/1043, Asia/Tokyo 1043/1043 (30 suites).
- Suite inteira (--maxWorkers=2, TZ do ambiente): 1845/1845, 71 suites.
- graphify update . (raiz): ok, grafo em graphify-out (ignorado pelo git).

Ajustes de teste feitos no caminho: 3 asserts de shape (credit-cycle.service.spec, insights.service.spec e a listagem
de transactions.card-link.spec) foram atualizados para o novo formato. A semantica e a mesma; no ramo cardId null o CREDIT
aparece de novo, redundante com o CREDIT de cima.

## Testes novos
- transactions.card-filter.spec.ts (8): avaliador de where em memoria (OR, null, AND implicito). Padrao de A inclui CREDIT sem cartao
  e exclui PIX/DEBIT/sem forma/receita nulos e o cardId do secundario; secundario so o proprio; padrao de B nao traz nada de A;
  sem filtro so o proprio usuario; cartao de B ou inexistente = 404 sem consulta; userId no where.
- transactions.card-link.spec.ts: bloco "receita nunca tem cartao" (6): criar com cardId = 400 em 3 combinacoes; criar sem cardId
  sem lock; editar com cardId no corpo = 400; virar receita limpa cardId e pega o lock; receita sem cartao nao mexe em cardId.
- recurring-transactions.card-link.spec.ts (3 + asserção de select): criar receita com cardId = 400; editar = 400; editar sem cardId nao mexe.
- credit-cycle.util.spec.ts (4): cardScopeWhere (padrao, secundario) e cardSpendWhere (countAllPayments, CREDIT padrao, secundario).

## Mutantes (14, arquivo restaurado a cada um, git status limpo ao fim)
Rodada: suites de transactions, recurring card-link, credit-cycle e insights.
- Mortos (14): M01 list sem userId; M02 padrao sem forma no nulo (inclui PIX/DEBIT); M03 secundario inclui nulos;
  M04 padrao sem nulos; M05 OR trocado por AND; M06 list com cardId puro; M07 create nao recusa INCOME;
  M08 update nao recusa cardId com INCOME; M09 virar INCOME nao limpa cardId; M10 lock do update sem dto.type;
  M11 create de lancamento nao passa type; M12 create de conta fixa nao passa type; M13 conta fixa sem type no select
  (SOBREVIVEU na 1a rodada, matado depois com asserção do select no teste); M14 INCOME checado depois da forma.
- Sobreviventes: 0 (apos a correcao do M13). Equivalentes: nenhum identificado.

## Migration: como conferir (NAO automatizado)
Em banco com User de monthClosingDay e creditDueDay iguais a 0, 40, -3 e NULL, depois de aplicar a migration:
SELECT "closingDay", "dueDay" FROM "CreditCard" WHERE "name" = 'Principal'; esperado: closingDay 1, 31, 1, 1 (para 0, 40, -3, 1 conforme o caso) e dueDay 1, 31, 1, NULL.
Antes de aplicar em producao: SELECT monthClosingDay, creditDueDay FROM "User" WHERE monthClosingDay NOT BETWEEN 1 AND 31 OR creditDueDay NOT BETWEEN 1 AND 31;

## NAO verificado
- Migration nao foi executada em banco real (sem Postgres nesta rodada; o teste de banco limpo/populado da 9a continua valido so para a versao antiga).
  Os valores acima sao esperados pela leitura do SQL, nao por execucao.
- Revisao independente com sonnet nao foi feita (regra do CLAUDE.md global: revisao com sonnet). Recomendado antes do merge.
- Integracao real na API (Postgres e Redis descartaveis) nao foi refeita para os 3 itens; cobertura e unitaria com mocks, como pede o brief.
- Achados 2, 4, 5 e 6 da revisao da 9a (Prisma e COMMIT, privacy-export, arquivados sem limite, Redis) nao sao escopo deste brief e seguem abertos.
