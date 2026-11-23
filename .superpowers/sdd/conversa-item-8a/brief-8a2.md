# Brief 8a-2 — frontend do editar/apagar + confirmação reforçada por botão

Base: contrato `docs/superpowers/specs/2026-11-19-conversa-contrato-item-8a.md` (seções 4.4, 5, 9-Frontend) e 8a-1 (backend já na `develop`). Branch de trabalho: `feat/8a2-frontend-editar-apagar` a partir da `develop`. Não commitar (o agente principal confere e commita).

## Problema atual (verificado)

- O preview de APAGAR chega ao app com `quickReplies: ['apagar','cancelar']` e o cartão ainda mostra o botão **Confirmar** que chama `POST /conversation/confirm` sem nada — o backend responde "responda apagar" (comportamento correto do 8a-1, mutante M11). Resultado: botão morto/enganoso no cartão de apagar.
- `GET /conversation/session` (RESTORED) devolve o rascunho sem indicar se é EDIÇÃO ou APAGAR, e `quickReplies: []` no turno restaurado.
- O contrato (§4.4) manda o botão do cartão enviar a ação de apagar **explícita** e o endpoint de confirmar aceitar apagar **só quando vier explícita**.

## Backend (pequeno, dentro do mesmo item)

1. `DraftView` ganha `changeAction?: 'EDIT' | 'DELETE'` (só para `kind: 'TRANSACTION_CHANGE'`; `toDraftView` preenche a partir do rascunho; nada muda para os outros kinds). Tipos: `backend/src/conversation/conversation.types.ts`; o `draft` do `getSession` já usa `DraftView`, então RESTORED passa a ter a informação.
2. `ConfirmConversationDraftDto` ganha `delete?: true`. `ConversationService.confirmDraft(userId, draftId, draftVersion, deleteExplicit?)`:
   - rascunho DELETE **sem** flag → exatamente o texto de hoje (`TX_REPLIES.deleteNeedsWord`, sem gravar) — o mutante M11 continua válido;
   - rascunho DELETE **com** flag → segue o mesmo caminho da palavra `apagar` digitada: relê `id+userId`, elegibilidade, `remove`, recibo, idempotência por `appliedKey`, falha auxiliar pós-commit padrão do motor;
   - flag em rascunho que NÃO é DELETE → ignorada (comportamento normal de confirmar).
   - Controller repassa a flag do dto. 404/versão antiga seguem iguais.
3. Isolamento (isolation.spec): confirmar DELETE de outra conta com `delete:true` = 404 sem revelar existência; `delete:true` não atravessa dono.

## Frontend

1. `frontend/src/app/core/models/conversation.models.ts`: `changeAction?: 'EDIT' | 'DELETE'` na `Draft`.
2. `assistant-page.component` (ts+html): quando `turn.draft.changeAction === 'DELETE'` e `showConfirmButtons`:
   - botão primário vira **"Apagar de vez"** (mesma classe `proto-button`, com modificador de perigo se o design system já tiver; senão só o texto) e chama o fluxo de confirmar passando `delete: true` na API;
   - o botão **Confirmar** simples NÃO aparece nesse caso; Cancelar permanece;
   - `visibleQuickReplies` continua filtrando `confirmar`/`cancelar`; em cartão DELETE também filtra `apagar` (o botão primário já faz isso — evitar duplicar ações).
   - RESTORED (sessão reaberta) usa `draft.changeAction` e ganha o mesmo cartão.
3. `confirmDraft(draftId, draftVersion)` do `conversationApi`: body aceita `delete?: true` (só enviado quando apagar). Erros/retry/`manualBusy` seguem o fluxo atual de ação de rascunho.
4. Edição (EDIT) e os outros cartões: nada muda.

## Testes

- Backend (specs existentes como guia): `confirmDraft` DELETE sem flag → texto precisa-da-palavra e nada gravado; com flag → apaga 1x, recibo `data.transactionId`, reconfirmação não repete (appliedKey), versão antiga → 404; flag em EDIT/OUTROS → normal; `DraftView.changeAction` presente só no rascunho de mudança; isolamento A/B com `delete:true`.
- Frontend (karma): cartão DELETE mostra "Apagar de vez" e chama confirm com `delete:true` (spy), nunca sem flag; RESTORED DELETE idem; EDIT mostra Confirmar normal; ghost `apagar` some do cartão DELETE; apagar em `manualBusy` fica desabilitado.

## Verificação antes de reportar

- `backend`: `tsc --noEmit`; `npx jest src/conversation src/transactions --maxWorkers=2`.
- `frontend`: `tsc -p tsconfig.app.json --noEmit` e `tsconfig.spec.json`; `ng test --watch=false --browsers=ChromeHeadlessCI` com `LD_LIBRARY_PATH=/tmp/opencode/chromelibs/usr/lib/x86_64-linux-gnu` (rodar suíte do assistant-page; suíte inteira fica com o agente principal).
- Reportar arquivos alterados e decisões extras. NÃO commitar.
