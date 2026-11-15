# Brief: Finanças por conversa, item 2b (frontend)

Para: subagente de desenvolvimento (haiku). Relatório final em estilo curto, sem enfeite. Código, comentários e textos de tela em português do Brasil, prosa normal.
Projeto: `/home/caminhao/coding/codeStage/Lumen`. Trabalhe só em `frontend/`. Não toque em `backend/`.

## Objetivo

Colocar o assistente manual (já pronto no backend) **dentro da tela do Selah que já existe**: `frontend/src/app/features/assistant/assistant-page/`. O usuário digita "50 mercado", vê o rascunho com botões Confirmar e Cancelar, e o lançamento é gravado. Perguntas de texto livre continuam indo para o Selah, como hoje.

Fora do escopo: WhatsApp, importação de nota, qualquer mudança em `backend/`, mudar o comportamento atual do Selah (consentimento de IA, limite de plano, histórico), tela nova ou rota nova, dependência npm nova.

## Leia antes de escrever código

1. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-1.md`: contrato do backend. Seções 3 (tipos), 4 (rotas e erros) e 6 (intenções e rascunho).
2. `backend/src/conversation/conversation.types.ts`: os tipos reais da resposta. Copie-os para o front (sem importar do backend).
3. `frontend/src/app/features/assistant/assistant-page/assistant-page.component.ts` e `.html` e `.scss`: a tela atual. Entenda `ask()`, `submitAssistantQuestion()`, `usePrompt()`, `loading`, `offlineMode` e como `activeMessage` é desenhado.
4. `frontend/src/app/core/services/life-api.service.ts` (`askAssistant`, `withOfflineFallback`): o padrão de chamada HTTP e `environment.apiBaseUrl`.
5. `docs/design-system.md` e as classes `proto-*` já usadas na tela: reuse, não invente cor, fonte ou componente novo. Tem de funcionar no tema claro e escuro e no celular.

## Rotas do backend (já existem e estão testadas)

Base: `${environment.apiBaseUrl}/conversation`. Todas autenticadas pelo mesmo mecanismo das outras chamadas (siga `LifeApiService`).

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /message` | `{ messageId: uuid, text: string }` (text 1 a 500 caracteres) | `ConversationReply` |
| `POST /confirm` | `{ draftId: uuid, draftVersion: int >= 1 }` | `ConversationReply`; 404 se o rascunho não existe, é de outra conta, ou já foi usado |
| `POST /cancel` | `{ draftId: uuid }` | `ConversationReply`; 404 igual |
| `GET /session` | nenhum | `{ state, draft? }` (`state` = `IDLE` ou o estado da conversa) |

`ConversationReply`: `{ kind, state, text, draft?, data?, quickReplies?, unrecognized? }`. `kind` ∈ `INFO | ASK_FIELD | CONFIRM_DRAFT | DONE | CANCELLED | EXPIRED | HELP | DUPLICATE | ERROR`. `unrecognized: true` aparece **só** quando o motor não entendeu o texto livre.

## Decisões (já tomadas, não reabra)

1. **Manual primeiro, Selah como reserva.** Ao enviar uma pergunta (e o app estar online), chame `POST /message` antes de qualquer outra coisa. Se a resposta tem `unrecognized: true`, siga o fluxo atual do Selah sem mudar nada (consentimento de IA, limite de plano, histórico). Qualquer outra resposta é mostrada como resposta do assistente manual e **não** chama o Selah. O consentimento de IA não vale para o fluxo manual, então a chamada manual vem antes da checagem de consentimento.
2. **Offline:** sem rede, ou com `offlineMode()` ligado, nem tenta o manual; segue o fluxo offline de hoje.
3. **Privacidade:** turnos do assistente manual **não** entram em `history`, não vão para `localStorage` e não chamam `saveAssistantTurn`. O servidor também não guarda o texto. Ficam só em memória, em um sinal próprio (`manualTurn`).
4. **Um cartão de resposta manual** aparece acima da área do Selah, mostrando o último turno manual (a pergunta do usuário e a resposta). Quando uma resposta do Selah chega, o cartão manual some; quando uma resposta manual chega, ele substitui. Não mude a estrutura de `history` nem de `AssistantMessage`.
5. **Idempotência:** gere um `messageId` com `crypto.randomUUID()` a cada envio novo. Se a chamada falhar por erro de rede ou 5xx, guarde `{ id, text }`; se o usuário reenviar o mesmo texto, reuse o mesmo `messageId` (assim a reentrega não duplica). Limpe ao ter sucesso.
6. **Carregando:** só mostre o texto "Consultando seus dados…" se a resposta demorar mais de 250 ms. Desabilite o envio enquanto a chamada está em curso. Os botões Confirmar e Cancelar também ficam desabilitados durante a chamada e não podem disparar duas vezes (duplo clique).
7. **Restaurar ao abrir:** ao iniciar a tela (online), chame `GET /session`. Se `state` não for `IDLE` e houver `draft`, mostre o cartão manual com o rascunho: texto "Você tem um rascunho em andamento.", e os botões se o estado for `AWAITING_CONFIRMATION`.

## O que construir

1. `frontend/src/app/core/models/conversation.models.ts`: tipos `ConversationReply`, `ConversationReplyKind`, `DraftView`, `ReplyData`, `ConversationSessionView`, copiados do backend.
2. `frontend/src/app/core/services/conversation-api.service.ts`: `sendMessage(messageId, text)`, `confirmDraft(draftId, draftVersion)`, `cancelDraft(draftId)`, `getSession()`. Sem fallback offline. Serviço próprio, não aumente o `LifeApiService`.
3. Na página do assistente (`.ts`, `.html`, `.scss`):
   - Fluxo de envio da decisão 1.
   - Cartão manual com: a pergunta do usuário, o `text` da resposta (preservando quebras de linha), e, quando houver `draft`, uma lista com Valor, Descrição, Categoria, Data e Forma de pagamento (omita o que for nulo).
   - Em `CONFIRM_DRAFT`: botões **Confirmar** (principal) e **Cancelar** (secundário). Eles chamam `/confirm` com `draftId` e `draftVersion` do rascunho, e `/cancel` com `draftId`.
   - Em `ASK_FIELD`: só o texto da pergunta; o usuário responde no mesmo campo de texto que já existe.
   - `quickReplies`: botões pequenos que enviam aquele texto como nova mensagem manual.
   - `EXPIRED`, `CANCELLED`, `ERROR`, `DUPLICATE`, `HELP`, `INFO`, `DONE`: mostre o `text`; `DONE` com tom de sucesso, `ERROR` com tom de erro, o resto neutro. Em `DUPLICATE`, chame `GET /session` e atualize o cartão.
   - Erro 404 em confirmar ou cancelar: mostre "Rascunho não encontrado ou já usado." e atualize a sessão.
   - Falha de rede ou 5xx: mensagem curta de erro com opção de tentar de novo (decisão 5). Nunca caia no Selah por causa de erro do manual.
   - Uma fileira de atalhos "Comandos rápidos" (`saldo`, `resumo`, `50 mercado`, `cartão`, `ajuda`) usando o mesmo mecanismo de `usePrompt`.
4. Acessibilidade: o cartão manual com `aria-live="polite"`; botões com texto claro; foco visível; alvo de toque confortável no celular.

## Testes

- `conversation-api.service.spec.ts` (obrigatório): cada método chama a URL e o verbo certos com o corpo certo (`HttpTestingController`).
- Teste do componente da tela (obrigatório se viável; senão explique por quê): `unrecognized: true` → chama o Selah; resposta normal → mostra o cartão e **não** chama o Selah; offline → não chama o manual; confirmar → chama `/confirm` uma vez mesmo com duplo clique; mesmo texto reenviado após falha reutiliza o `messageId`; turno manual não é gravado em `localStorage` nem em `saveAssistantTurn`.
- Rode a suíte existente inteira para garantir que nada quebrou.

## Como verificar (rode e cole a saída resumida no relatório)

Dentro de `frontend/`:
1. `npx ng test --watch=false --browsers=ChromeHeadless` (se não houver Chrome headless, diga o que falhou; não afirme que passou).
2. `npm run build`.
Na raiz, ao final: `graphify update .` (um só, nunca em paralelo).

## Proibições

- Não fazer commit, push, amend, reset nem deploy. Deixe as mudanças na árvore de trabalho.
- Não alterar `backend/` nem o contrato. Dúvida ou conflito com o contrato: escreva em `.superpowers/sdd/conversa-item-2b/duvidas.md` e pare naquele ponto.
- Sem segredo em arquivo. Sem dependência npm nova.
- Não "melhorar" código fora do escopo.

## Relatório final (curto)

Arquivos criados e alterados, saída resumida dos comandos, decisões que você tomou onde este brief era omisso, e o que você **não** conseguiu verificar (por exemplo, a tela em navegador real).
