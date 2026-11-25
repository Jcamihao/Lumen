# 11b-1b — Cartões compartilhados (backend)

Data: 2026-11-25. Sessão: Qwen 3.8 Flash Next (OpenCode), agente único, sem subagentes e nada da Anthropic.
Branch `feat/carteira-11b1b` (base `27e0f47`, develop da época; develop recebeu depois as fases 12 do bot e foi mergeada na branch em `b9741be`, limpa, zero conflito — nenhuma das fatias 12 tocou cartão/ciclo/lançamento/escopo).

## Contrato
`docs/superpowers/specs/2026-11-25-conversa-contrato-item-11b1b.md` (D1–D8), redigido pela própria sessão como decisão assumida sob o guarda-chuva do contrato 11b aprovado pelo dono ("recomendações" em todas as decisões). Dono pode vetar ao voltar.

- **D1** `CreditCard.sharedGroupOwnerId` + migration à mão `20261125140000_carteira_compartilhada_cartoes` (só ADD COLUMN/INDEX; os únicos parciais do 9a não são tocados).
- **D2** `PATCH /credit-cards/:id/sharing` só para o autor do cartão; exige grupo SHARED ativo (409 `SHARING_NEEDS_ACTIVE_GROUP`); arquivado → 409; idempotente; devolve recibo `{id, isShared, updatedAt}`. **Desmarcar também desmarca os lançamentos de outro membro que apontavam para o cartão** (privacidade primeiro).
- **D3** `GET /credit-cards?scope=mine|shared|all`: no `shared` só cartão marcado e não arquivado do parceiro, com as flags de shared-view (`isShared`/`isMine`/`sharedByName`), sem `userId` nem `sharedGroupOwnerId` na linha; `includeArchived` vale só para os próprios.
- **D4** Teto editável por qualquer membro do grupo no cartão compartilhado: a linha `CreditCycleCeiling` fica com o **dono do cartão**, o lock `FOR NO KEY UPDATE` é na linha **do dono do cartão** (peek do `card.userId` antes da transação → ordem de lock única, sem deadlock cruzado), e os dois engines (quem escreveu + dono) são tocados. v1 não audita quem escreveu.
- **D5** O ciclo de um cartão compartilhado soma o gasto do **grupo** (meu + compartilhados) no AND do where, com fuso e datas do **dono do cartão**; cada cartão mantém `countAllPayments` próprio.
- **D6** `cardId` de cartão compartilhado do parceiro em create/update de lançamento: o lançamento **nasce compartilhado por construção** (`sharedGroupOwnerId` do grupo); sem o acesso compartilhado o comportamento é idêntico ao de sempre (404). Contas fixas e parceladas continuam só com cartão próprio.
- **D7** Editar, arquivar, promover padrão: continuam autor-only (404 para o parceiro, sem 403 nem vazamento).
- **D8** Saída/remoção de membro: `detachSharedItems` também desmarca os **cartões** do membro (mesmo where autor+grupo).

## Arquivos
- `backend/prisma/schema.prisma` + `backend/prisma/migrations/20261125140000_carteira_compartilhada_cartoes/migration.sql`
- `backend/src/credit-cards/` (service com `setSharing`/list com escopo/`toPartnerCardView`, controller, dto, módulo com `AccessScopeModule`)
- `backend/src/credit-cards/card-link.ts` (`resolveCardForCreateShared`/`resolveCardForUpdateShared`/`findUsableCard` com lock na linha do dono do cartão parceiro)
- `backend/src/credit-cycle/` (service com `findVisibleCard`, gasto do grupo, teto com lock no dono, `refreshAfterCeiling` nos dois; `credit-cycle.util.ts` com `cardSpendWhere(userWhere, card, …)` em **forma AND** — o OR do escopo nunca pode ser sobrescrito pelo OR do cartão)
- `backend/src/transactions/transactions.service.ts` (create/update usam os resolvers compartilhados)
- `backend/src/billing/group.service.ts` (D8)
- `backend/src/insights/insights.service.ts` (chamada nova do `cardSpendWhere` com `{ userId }` — agregados do grupo ficam para a 11b-3)
- Especs: `credit-cards.service.spec.ts` (+16), `credit-cycle.service.spec.ts` (+6), `credit-cycle.spend.spec.ts`/`credit-cycle.util.spec.ts` (formato AND), `transactions.card-link.spec.ts` (+7), `group.service.spec.ts`, `isolation.spec.ts` (saída desmarca cartão)

## Fora do escopo (drive-by corrigido na mesma branch)
- **Fix do app (9c-2):** fila offline gravada por versão antiga do app podia trazer `monthClosingDay`/`creditDueDay`/`creditCycleCountAllPayments` no payload de `user`; o whitelist do backend responde 400 e o 400 travava a fila inteira atrás do item. `stripLegacyUserPatchKeys` sanitiza no enfileirar e no reproduzir; payload que fica vazio conclui sem requisição. Commits `ccf20f0` (+spec) e testes novos em `offline-life.service.spec.ts` e `life-api.user-sync.spec.ts`.

## Verificado (tudo com `nice -n 19` e `--maxWorkers=1`, pedido do dono — notebook esquentando)
- `tsc --noEmit` limpo na branch e pós-merge da develop.
- **Jest inteiro na branch:** 94 suítes / **2447** verdes. **Pós-merge da develop (com as fases 12 do bot):** 104 suítes / **3369** verdes.
- Foco 7 módulos (credit-cards/credit-cycle/transactions/billing/conversation/telegram/access-scope) em UTC, America/Sao_Paulo e Asia/Tokyo (pós-merge, em `conf-posmerge-11b1b.txt`).
- **Mutantes: 14/14 mortos** (`mutantes-11b1b.sh` + M8 refeito à mão — o sed do script quebrava o ternário em 3 linhas e suite que não compila some do sumário; refiz com perl multi-linha e morreu). M1 cascata de desmarcar, M2 arquivado, M3 idempotência, M4/M5 listagem shared, M6/M7/M8 lançamento no cartão do parceiro, M9–M13 teto/ciclo do parceiro (linha com o dono, lock, fuso, arquivado, engines), M14 AND do escopo.
- **Integração real** em ambiente descartável (bins Postgres 18.6 + Redis 8 em 5546/6392, backend real com billing em 3100, Asaas dummy; `integrar-11b1b.sh` + `integracao-11b1b.mjs`): **31 checagens, 0 falhas** — grupo Ana/Bia via grant+convite; marcar/desmarcar com recibo e banco conferido por psql; `shared:"false"` recusado (400); parceiro 404 ao tentar desmarcar; escopo shared/all/sem-grupo com primeiro nome e sem campos internos; **teto escrito pela Bia com `userId` da Ana no banco**; leitura do ciclo pela Bia; lançamento da Bia no cartão da Ana **nasce compartilhado** (conferido no banco) e o gasto já soma no ciclo da Ana; cartão não compartilhado da Ana continua 404 para a Bia; desmarcar desmarca o lançamento da Bia junto e ele continua privado dela; arquivado → 409; editar alheio → 404.
- **Regressões reaplicadas no mesmo ambiente:** integração da 9c-2 **15/15** e rv9c-api (concorrência do teto, 9c-1c) **16/16** — o backend da fase 2 sobe sem `BILLING_ENABLED` (os dois scripts foram escritos contra FREE). Migration nova aplicada do zero (`migrate deploy`), `migrate diff` sem diferença contra o shadow DB, e os índices parciais de `CreditCard` seguem em 5 no `pg_indexes`. Ambiente derrubado no fim; containers do dono intocados; nenhuma porta proibida usada.
- **Karma inteira: 553/553** (6 novos no fix da fila; baseline era 547) + `ng build` ok. Pós-merge da develop reconfirmado em fila sequencial.

## NÃO verificado / riscos aceitos
- **Push da develop continua impossível** aqui (sem credencial do GitHub). `git push origin develop` leva tudo desde `d4a0d14`, com as tags locais.
- v1 do teto compartilhado **não audita quem escreveu** (a linha guarda só o dono do cartão) — decisão D4.
- **Concorrência real de teto no cartão compartilhado** (os dois gravando ao mesmo tempo no Postgres de verdade) não foi rodada — coberta por testes unitários de lock e pelo padrão rv9c no cartão solo; a ordem de lock (linha do dono primeiro) elimina o deadlock por construção.
- Insights/agregados **do grupo** ficam para a 11b-3 (insights seguem "Meu"). Bot e WhatsApp não conhecem cartão compartilhado (11b-3). Exportação LGPD não inclui cartões (limitação antiga do 9a, continua).
- Integração com Telegram falso (contrato 11b-1a) não reaplicada para cartões — ela cobre lançamentos/categorias.
- Migration só exercitada no Postgres descartável 18.6 (produção pode ser 16): é ADD COLUMN nullable + CREATE INDEX, seguro nos dois.
- Tela do app ainda não mostra cartão compartilhado (11b-2).
