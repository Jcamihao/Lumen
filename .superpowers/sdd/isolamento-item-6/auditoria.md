# Auditoria de escopo (item 6): motor de conversa e WhatsApp

Branch `feat/isolamento-whatsapp`. Método: li o código de `backend/src/conversation/**`, `backend/src/whatsapp/**` e os métodos dos serviços de domínio que o motor chama. Cada linha abaixo foi lida, não presumida. Veredito `OK` = o `where` leva `userId` (ou o id vem de uma linha já filtrada por `userId` na mesma operação). `OK*` = não leva `userId` no `where`, mas o id é gerado ou lido no servidor, na mesma requisição, de uma linha já filtrada; detalhe na coluna.

Chave de escopo: `userId` só vem do JWT (`@CurrentUser().sub`, `ConversationController`, `WhatsappController`) ou de `WhatsappLink` (`jid` -> `userId`, `WhatsappAdapterService.handleLinked`). Nenhum DTO tem campo `userId`/`accountId` (e o `ValidationPipe` global usa `forbidNonWhitelisted`: campo extra vira 400).

## 1. Rotas

| Rota | Origem do `userId` | Entradas do cliente | Veredito |
|---|---|---|---|
| `POST /conversation/message` (`conversation.controller.ts:19`) | JWT `user.sub` | `messageId` (UUID), `text` | OK |
| `POST /conversation/confirm` (`:32`) | JWT | `draftId` (UUID), `draftVersion` (int). Consulta `findFirst({id, userId, state})`; id alheio = `null` = 404 igual a id inexistente | OK |
| `POST /conversation/cancel` (`:43`) | JWT | `draftId`. `findFirst({id, userId})`; `null` = 404 | OK |
| `GET /conversation/session` (`:54`) | JWT | nenhuma | OK |
| `POST /whatsapp/link-code`, `GET /status`, `DELETE /link` (`whatsapp.controller.ts:36-48`) | JWT | nenhuma | OK |
| `POST /whatsapp/webhook` (`whatsapp.controller.ts:60`) | nenhuma: `@Public`, autenticado só por HMAC sobre o corpo bruto; o dono vem do vínculo | corpo inteiro (não confiável) | OK |
| Importação de nota | O motor NÃO chama `ImportsService`: `import_receipt` só responde texto e `data.screen='imports'` (`conversation.service.ts:381`, `:374`); mídia no WhatsApp responde texto fixo (`whatsapp-adapter.service.ts:136`). Nenhuma rota de importação é acionada pelo motor | OK (inalcançável) |

## 2. Consultas Prisma diretas do motor (`conversation.service.ts`)

| Linha | Operação | `where` | Veredito |
|---|---|---|---|
| 273 | `conversationEvent.findFirst` (duplicata) | `{userId, channel, messageId}` | OK |
| 293 | `conversationSession.findFirst` (confirmar por `draftId`) | `{id: draftId, userId, state}` | OK. `draftId` vem do corpo, é escopado |
| 308 | `conversationSession.findFirst` (cancelar por `draftId`) | `{id: draftId, userId}` | OK |
| 743 | `envelope.findFirst` (nome repetido) | `{userId, name}` | OK |
| 759 | `conversationSession.create` | `data.userId` do input | OK |
| 870 | `conversationSession.updateMany` (preencher campo, controle de versão) | `{id, userId, version}` | OK |
| 1178 | `conversationSession.deleteMany` (reivindica o rascunho ao confirmar) | `{id, userId, version}` | OK. Atômico: só um confirmar vê `count=1` |
| 1204, 1212, 1219, 1237 | `conversationEvent.updateMany` (resultado do evento) | `{id: event.id, userId}` | OK |
| 1478, 1488 | `conversationEvent.create` (chave `appliedKey`) | `data.userId` | OK |
| 1505 | `conversationSession.create` (restaura rascunho) | `data.userId` | OK |
| 1527 | `conversationSession.deleteMany` (cancelar) | `{id, userId}` | OK |
| 1539 | `conversationSession.deleteMany` (expirar) | `{id, userId}` | OK |
| 1626, 1707, 2201 | `user.findUniqueOrThrow` (fuso) | `{id: userId}` | OK (é a própria conta) |
| 1632 | `transaction.groupBy` (gasto por categoria) | `{userId, type, date}` | OK |
| 1637 | `financeCategory.findMany` | `{userId}` | OK |
| 1825, 1850 | `financeCategory.findMany` (categoria por nome ou por número) | `{userId, type}` | OK. Categoria por nome/número: só entre as da conta |
| 2111 | `financeCategory.findFirst` (nome da categoria no cartão) | `{id: draft.categoryId, userId}` | OK. O `categoryId` do rascunho é lido do banco; mesmo assim é escopado |
| 2187 | `financeCategory.findMany` (opções de categoria) | `{userId, id: {in}}` | OK |
| 2197 | `conversationSession.findFirst` (`loadSession`) | `{userId, channel}` | OK. Usado por `handleMessage` e `getSession` |
| 2239 | `conversationEvent.create` | `data.userId` | OK |

Nenhum `findUnique`, `update` ou `delete` por `id` sem escopo no motor. Todas as mudanças de sessão e evento usam `updateMany`/`deleteMany` com `userId`.

## 3. `getSession` (D9, `conversation.service.ts:323`)

`loadSession(userId, APP)`; se não houver ou expirou, `loadSession(userId, WHATSAPP)` e só devolve se `AWAITING_CONFIRMATION` e não expirada. As duas buscas usam `{userId, channel}`. `toDraftView` só lê metas por `goals.list(userId)` (filtra `goal.userId === userId` de novo, L2161) e categoria por `{id, userId}` (L2111). Veredito: OK. Sem `userId`: não chega aqui (sempre o do JWT).

## 4. Chamadas a serviços de domínio pelo motor

Todas recebem o `userId` do próprio motor (nunca do rascunho). O que existe no rascunho (JSON da sessão) são ids de categoria/meta escolhidos pelo motor entre as linhas da conta.

| Chamada no motor | Linha | Serviço e `where` interno (li) | Veredito |
|---|---|---|---|
| `dashboard.getSummary` (saldo) | 1814 | `dashboard.service.ts:22-`: cache `dashboard:summary:${userId}`; `transaction.groupBy/findMany`, `goal`, `task`, `reminder`, `notification` todos com `userId`; `insights.list` e `forecasts.getCurrent` com `{userId}`; materializers com `userId` | OK |
| `creditCycle.getCurrent` | 625, 1607 | `credit-cycle.service.ts:25-`: `user {id}`, `creditCycleCeiling {userId_closingDate}`, `transaction.aggregate {userId}` | OK |
| `goals.list` | 2159, 1764 | `goals.service.ts:22`: `{userId}`; o motor filtra `goal.userId===userId` outra vez | OK |
| `recurring.list` | 1656, 1715 | `recurring-transactions.service.ts:57`: `materializeDue(userId)` (`{userId, isActive}`) e `findMany {userId}` | OK |
| `installments.list` | 1679, 1716 | `installments.service.ts:66`: idem | OK |
| `envelopes.list` | 1792 | `envelopes.service.ts:23`: `{userId}`; top-ups por `envelopeId` de linha já escopada | OK |
| `entitlements.assertCanCreate` | 453, 560, 731 | `entitlements.service.ts:82`: contagens com `{userId}` | OK |
| `transactions.create` | 1404 | `transactions.service.ts:71`: `validateRelationships` com `{id: categoryId, userId}`; `create` com `userId` do argumento | OK |
| `goals.create` | 1426 | `goals.service.ts:31`: `create` com `userId` | OK |
| `goals.contribute` | 1442 | `goals.service.ts:101`: transação com `SELECT ... WHERE id AND userId FOR UPDATE` e `findFirst {id, userId}`; o `goal.update({where:{id}})` (L118) vem depois dessa checagem, na mesma transação | OK* (checagem prévia no mesmo `$transaction`) |
| `envelopes.createForConversation` | 1308 | `envelopes.service.ts:44`: `envelope.create` com `userId` | OK |
| `creditCycle.setCeilingForConversation` | 1326 | `credit-cycle.service.ts:93`: `upsert {userId_closingDate}` e `FOR NO KEY UPDATE` em `User {id: userId}` | OK |
| `recurring.createForConversation` | 1349 | `recurring-transactions.service.ts:84`: `validateCategory {id, userId}`; `create` com `userId` | OK |
| `installments.createForConversation` | 1379 | `installments.service.ts:93`: idem | OK |

Limite de plano (`PlanLimitException.message`) é a única mensagem de domínio devolvida por texto (`discardText`, L2479); ela carrega recurso, limite e plano da própria conta. Demais recusas viram texto fixo.

## 5. WhatsApp (`backend/src/whatsapp/**`)

| Arquivo:linha | Operação | `where` | Veredito |
|---|---|---|---|
| `whatsapp-link.service.ts:67` | `whatsappLink.findUnique` (conta já vinculada, 409) | `{userId}` | OK |
| `:75-77` | `$transaction`: `whatsappLinkCode.deleteMany {userId, usedAt:null}` + `create {userId, codeHash, expiresAt}` | com `userId` | OK |
| `:94` | `whatsappLinkCode.findFirst` (resgate) | `{codeHash, usedAt:null, expiresAt>now}`. Sem `userId` de propósito: o código identifica a conta. Só o hash fica no banco; formato fechado (8 chars) | OK |
| `:102` | `whatsappLinkCode.updateMany` (consome o código) | `{id, usedAt:null, expiresAt>now}`; `id` da linha do `findFirst` acima | OK* |
| `:112` | `whatsappLink.findUnique` (jid já usado) | `{jid}` (a chave é o número, por desenho) | OK |
| `:113` | `whatsappLink.findUnique` (conta do código já vinculada) | `{userId: candidate.userId}` | OK |
| `:120` | `whatsappLink.create` | `data {userId: candidate.userId, jid}`; `userId` do código, `jid` do remetente assinado | OK |
| `:132` | `whatsappLink.findUnique` (status) | `{userId}` | OK |
| `:143-145` | `$transaction`: `whatsappLink.deleteMany {userId}` + `conversationSession.deleteMany {userId, channel: WHATSAPP}` | com `userId` | OK |
| `:151` | `whatsappLink.findUnique` (dono do jid) | `{jid}`; único no banco | OK |
| `whatsapp-adapter.service.ts:100-110` | Identidade: `findUserIdByJid(message.jid)`; sem vínculo, nunca chama o motor | n/a | OK. Campos `userId`, `accountId`, `user`, `participant`, `remoteJid` do corpo nunca são lidos (`parseInbound` lê só `event`, `sessionId`, `data.key.fromMe/id`, `data.isGroup`, `data.from`, `data.type`, `data.content`) |
| `whatsapp-adapter.service.ts:152-158` | `conversation.handleMessage({userId (do vínculo), channel:'WHATSAPP', messageId: key.id, ...})` | n/a | OK |
| Rate limit/Redis | chaves `whatsapp:rate|linkfail|hint:<sha256(jid)>` | só hash do `jid` | OK |

## 6. Trava de escrita pelo WhatsApp

`applyDraft` é chamado em dois lugares: `confirmDraft` (botão do app, `conversation.service.ts:303`, não passa pelo WhatsApp) e o ramo de `CONFIRM_WORDS` em `handleWithSession` (L797-805), que com `channel === 'WHATSAPP'` e `whatsapp.writesEnabled` falso responde `whatsappWritesOff` antes. `applyByKind` só é chamado por `applyDraft`. Os outros ramos (`fillPendingField`, leituras, ajuda, `import_receipt`) nunca chamam serviço de escrita. Veredito: OK. Observação de desenho: o botão do app (`POST /conversation/confirm`) confirma também o rascunho vindo do WhatsApp (D9), com a trava desligada. É escolha do dono, não falha: exige JWT do dono da sessão.

## 7. Logs e erros (item 7 das regras)

`Logger` usado em: `conversation.service.ts:628` e `:1562` (`intent` e nome do erro, sem texto), `whatsapp-adapter.service.ts:88` (nome do erro) e `:171` (número mascarado e motivo), `whatsapp-link.service.ts` (declara `logger`, mas não o usa). Materializers: `recurring_materialized userId=<próprio userId>` (o id da própria conta, sem dado de outra). Veredito: OK.

## 8. Pontos de atenção (não são falha de escopo)

- `appliedKey = "${session.id}:${session.version}"` é global (`@unique`), mas `session.id` é UUID gerado pelo servidor; não há como outra conta colidir.
- `ConversationEvent @@unique([userId, channel, messageId])`: o `messageId` do WhatsApp é escopado por conta e canal; a mesma `key.id` em duas contas não colide.
- Redis fora: o limite por número falha fechado para números sem vínculo; para vinculados segue (já registrado no 5a).
