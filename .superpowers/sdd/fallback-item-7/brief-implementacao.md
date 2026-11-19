# Brief de implementação — item 7 (fallback de IA por plano, sem escrita por IA)

Read o contrato completo primeiro: `docs/superpowers/specs/2026-11-19-conversa-contrato-item-7.md`. Repo: `/home/caminhao/coding/codeStage/Lumen-item7`, branch `feat/fallback-ia-item-7`. **NÃO faça git commit/add** — o agente principal confere e commita. Dependências já instaladas.

Padrões obrigatórios do repo: Conventional Commits em português (não commitados por você); recibo do que foi persistido; identidade sempre do usuário autenticado; só o `AssistantService` fala com o SelahIA (não crie outro caminho HTTP para o Selah); testes seguem o estilo dos specs existentes (`conversation.service.spec.ts` usa fakes de Prisma; `assistant.service.spec.ts` espiona o método privado `postJson`).

## A. Prisma

1. `backend/prisma/schema.prisma`: no `enum ConversationOutcome` (após `ERROR`) adicione `AI_ANSWERED`, `AI_BLOCKED`, `AI_UNAVAILABLE`.
2. Crie a migration **manualmente** (NÃO rode `prisma migrate dev` — o banco local 5433 tem migration fora do repo e é compartilhado; proibido mexer): pasta `backend/prisma/migrations/20261119120000_ai_fallback_outcomes/migration.sql` com um `ALTER TYPE "ConversationOutcome" ADD VALUE IF NOT EXISTS '<valor>';` por valor (confira o nome do tipo nas migrations existentes de `conversation_session`).
3. Rode `npx prisma generate` em `backend/` (usa `../.env`, que já existe).

## B. Configuração

1. `backend/src/config/app.config.ts`: campo `assistantAiMode: process.env.ASSISTANT_AI_MODE?.trim().toLowerCase() === 'fallback' ? ('fallback' as const) : ('off' as const)`.
2. `.env.example`: documente `ASSISTANT_AI_MODE=off` (valores `off|fallback`) e `SELAH_FALLBACK_TIMEOUT_MS=15000` perto dos outros `SELAH_*`.

## C. AssistantService — método público novo (única camada Selah)

Em `backend/src/assistant/assistant.service.ts`:

```ts
export type AssistantFallbackOutcome =
  | { status: 'answered'; text: string }
  | { status: 'blocked_by_plan' }
  | { status: 'no_consent' }
  | { status: 'unavailable' };

async tryFallbackAnswer(userId: string, question: string): Promise<AssistantFallbackOutcome>
```

Ordem (sem lançar exceção nunca):
1. `loadPrivacySettings(userId)` (já existe): sem `privacyNoticeAcceptedAt` OU sem `aiAssistantEnabled`/`aiAssistantConsentAt` → `no_consent`.
2. `entitlements.assertCanAskSelah(userId)`: catch de `PlanLimitException` → `blocked_by_plan` (rethrow do resto).
3. Chamar `askSelah` (método privado existente) com `summary = await dashboardService.getSummary(userId)`, `history: []`, `originModule: 'general'`. **Timeout de fallback**: adicione um parâmetro opcional `timeoutMs` em `askSelah` (default = comportamento atual `this.readTimeout()`); no fallback passe `SELAH_FALLBACK_TIMEOUT_MS` (padrão 15000, mesmo estilo de `readTimeout`).
4. `selahResult.reply` nulo → `unavailable` (NÃO usar `buildLocalReply`: proibido inventar resposta).
5. Resposta: texto = `reply.answer` aparado; vazio → `unavailable`. Senão `await entitlements.recordSelahQuestion(userId)` UMA vez e retorne `{ status: 'answered', text }`. Nenhum outro campo da resposta do Selah é usado. O payload é só o `buildSelahPayload` existente (leitura; sem ferramentas de escrita).

## D. ConversationService — roteador do fallback

`backend/src/conversation/conversation.service.ts`:

1. `ConversationModule` (conversation.module.ts) importa `AssistantModule`; injete `private readonly assistant: AssistantService` no construtor.
2. `conversation.types.ts`: em `ConversationReply` adicione `aiFallback?: true` (com comentário: resposta veio do fallback de IA, nunca de escrita).
3. `replies.ts`: adicione
   - `aiFallbackBlocked: 'Não entendi. As perguntas com IA do seu plano já acabaram neste mês. ' + <exemplos help existentes concatenados como string literal simples>` (não referencie `REPLIES.help` por ordem de inicialização se der problema; escreva o texto completo).
   - `aiFallbackUnavailable: 'Não entendi. A IA está indisponível agora. ' + exemplos…`
   - `aiFallbackHelp: 'Não entendi. ' + exemplos…` (usado quando `no_consent`).
4. Método privado novo:
```ts
private async handleUnrecognized(input: ConversationInput, text: string, controlWord: boolean): Promise<ConversationReply>
```
   - `controlWord === true` OU modo `off` (`configService.get('app.assistantAiMode')`): comportamento EXATAMENTE de hoje — `recordEvent(input, null, UNRECOGNIZED)`; `help = reply('HELP','IDLE',REPLIES.unrecognized)`; retorna `controlWord ? help : { ...help, unrecognized: true }`.
   - Modo `fallback`:
     - `const outcome = await this.assistant.tryFallbackAnswer(input.userId, text)`
     - `answered` → `recordEvent(input, 'ai_fallback', ConversationOutcome.AI_ANSWERED)` e retorna `{ kind: 'INFO', state: 'IDLE', text: outcome.text, aiFallback: true }`.
     - `blocked_by_plan` → evento `('ai_fallback', AI_BLOCKED)` + `reply('HELP','IDLE',REPLIES.aiFallbackBlocked)`.
     - `no_consent` → evento `('ai_fallback', AI_BLOCKED)` + `reply('HELP','IDLE',REPLIES.aiFallbackHelp)`.
     - `unavailable` → evento `('ai_fallback', AI_UNAVAILABLE)` + `reply('HELP','IDLE',REPLIES.aiFallbackUnavailable)`.
     - Nestes quatro caminhos NÃO setar `unrecognized`.
5. Substitua os DOIS pontos que hoje marcam `unrecognized: true`:
   - `handleWithoutSession` (~linha 345): hoje grava `recordEvent(UNRECOGNIZED)` e monta `help`/`control`. Passe para `return this.handleUnrecognized(input, text, control)` removendo a gravação de evento de lá (o `handleUnrecognized` grava — cuidado para NÃO gravar dois eventos no mesmo messageId: UNIQUE `(userId, channel, messageId)`).
   - Fluxo de aporte (~linha 524, comentário "é conversa, não comando"): `return this.handleUnrecognized(input, text, false)` — o `text` é o texto completo da mensagem (disponível no escopo; se preciso, ajuste a assinatura do método-chamador para receber `text`).
   - NÃO toque no `reply('ERROR', ..., REPLIES.unrecognized)` de parse (~linha 1620): não é caminho de fallback.
6. Se `tryFallbackAnswer` lançar erro inesperado: registre `AI_UNAVAILABLE` e responda `REPLIES.aiFallbackUnavailable` (fallback nunca pode derrubar a conversa; nunca tenta de novo).

## E. WhatsApp

`formatReplyForWhatsapp` já formata `INFO` como texto — confira (teste) que uma resposta `aiFallback: true` sai como texto simples sem cartões. Nenhuma mudança esperada em `whatsapp/`.

## F. Frontend (Angular standalone)

1. `frontend/src/app/core/models/conversation.models.ts`: `ConversationReply` ganha `aiFallback?: true`.
2. `assistant-page.component.ts` → `sendManual`: REMOVA o bloco `if (reply.unrecognized) { this.askSelah(question); return; }` — o campo passa a ser ignorado (comentário curto: roteador decidiu; contrato item 7). A resposta (`HELP` com texto de ajuda, ou `INFO` com `aiFallback`) entra em `applyManualReply` normalmente. Verifique como `applyManualReply` renderiza `INFO`/`HELP` sem draft: precisa sair como balão de texto (sem cartão). Se `aiFallback` precisar de rótulo próprio no histórico, trate como balão de texto simples.
3. Indicadores (decisão 6 + spec "Carregamento e timeout"): o `startManualBusy` atual mostra hint aos 250 ms (`MANUAL_SLOW_HINT_MS`). Implemente estágios: 250 ms "Consultando seus dados…"; 3 s "Organizando a resposta…"; 5 s acrescenta "Pode demorar um pouco." (mantenha o template/aria atual coerente; ajuste o `.html` e os testes e2e-unit existentes).
4. Retry com requisição em voo é PROIBIDO (duplicaria crédito). Retry só no caminho de erro atual (mesmo messageId).

## G. Testes (jest)

Backend (estenda os specs existentes; fakes como os atuais):
1. modo `off`: resposta e evento idênticos aos de hoje nos dois pontos (regressão).
2. modo `fallback` + `answered`: resposta `INFO`/`IDLE` com `aiFallback: true`, evento único `intent 'ai_fallback'`/`AI_ANSWERED`, SEM `unrecognized`, e NENHUM serviço de escrita chamado (espione `transactions.create`, `goals.*`, `envelopes.*`, `creditCycle.*`, `recurring.*`, `installments.*` e afirme não-called).
3. `blocked_by_plan` e `no_consent`: HELP contextual, evento `AI_BLOCKED`, stub do assistant NÃO chamado no caminho off… (no serviço de conversa: stub `tryFallbackAnswer` retorna o outcome; teste o mapeamento). No `assistant.service.spec.ts` (espião `postJson`): `no_consent` e `blocked_by_plan` NUNCA chamam `postJson` nem `recordSelahQuestion`; `answered` chama `postJson` 1x e `recordSelahQuestion` 1x e usa só `answer`; `unavailable` (postJson 500 / payload inválido / integração desligada) não cobra crédito; `SELAH_FALLBACK_TIMEOUT_MS` é o timeout usado no fallback (espione `postJson` e confira o argumento).
4. Reentrega do mesmo `messageId` no fallback → `DUPLICATE` (um único evento).
5. Aporte com "nome que não é meta" em modo fallback → vai para `handleUnrecognized` (não cria rascunho).
6. Isolamento: `tryFallbackAnswer` usa `dashboardService.getSummary(userId)` do próprio `userId` (teste com dois usuários nos fakes).

Frontend (`assistant-page.component.spec.ts` atual como guia):
7. `unrecognized: true` na resposta NÃO dispara mais chamada ao API do Selah (spy) e mostra o texto de ajuda.
8. Resposta `INFO` + `aiFallback` vira balão de texto no histórico.
9. Estágios 250 ms / 3 s / 5 s com `fakeAsync`/`tick`.

## H. Verificação final sua (antes de reportar)

- `cd backend && npx tsc --noEmit` limpo; rode os specs afetados: `npx jest conversation assistant whatsapp billing` (do worktree, `cd backend`).
- `cd frontend && npx tsc -p tsconfig.app.json --noEmit` (ou `npx ng build --configuration development` se mais simples) e rode os specs do assistant-page: `npx ng test --watch=false --browsers=ChromeHeadlessCI --include='**/assistant-page/**/*.spec.ts'` se o projeto permitir filtro; senão rode o suite.
- NÃO rode o suite inteiro (o principal roda). NÃO commite.

Reporte: lista de arquivos alterados, decisões que tomou além do brief, o que passou/falhou nos comandos acima.
