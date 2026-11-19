# Revisão do item 7 (fallback de IA) — resultado

Data: 2026-11-19. Revisor: sonnet. Commits revisados: `7016ef2..HEAD` (4b717b1, 28cd6ea, 853fdc2, 186558f). Nada foi commitado nem adicionado ao git; nenhum `prisma migrate` rodado; só o worktree `Lumen-item7` foi tocado.

## Veredito

**Aprovado com ressalvas.** A implementação segue o contrato nos pontos de entitlement e isolamento: ordem consentimento → plano → IA, nenhum crédito sem resposta, nenhuma resposta inventada, um evento por `messageId`, nenhuma escrita no caminho do fallback, sem `unrecognized` no modo fallback e exceção do fallback contida. Encontrei **1 defeito real de código** (corrigido) e **1 conflito de contrato que exige decisão do dono** (não alterado). Também havia lacunas de teste, fechadas abaixo.

## Defeitos reais

### D-1 (corrigido): reentrega do mesmo `messageId` com a IA em voo cobrava crédito duas vezes
O evento `ai_fallback` só é gravado **depois** da chamada à IA. A checagem de `DUPLICATE` do `handleMessage` consulta esse evento, então uma reentrega durante a espera (até 15 s: retry do app, redelivery do webhook do WhatsApp) passava pela checagem. Resultado: duas chamadas ao Selah e dois `recordSelahQuestion` para a mesma mensagem. Isso quebrava a garantia "mantém a proteção de duplicidade por messageId".

Correção em `conversation.service.ts`: um `Set` em memória (`fallbackInFlight`, chave `userId:channel:messageId`). Se a chave já está em voo, devolve `DUPLICATE` sem chamar a IA e sem gravar evento. O `finally` libera a chave, inclusive quando a IA lança erro. Limite: a trava vale por processo. Com várias instâncias do backend atrás de um balanceador sem afinidade, a janela continua aberta (ver "Não verificado").

### D-2 (NÃO corrigido, decisão do dono): conflito entre contrato §1 e §4 no modo `off` do app
O §1 diz que, em `off`, o comportamento é "exatamente como hoje". O §4 manda remover o desvio `unrecognized → askSelah` do `sendManual`, e foi o que o haiku fez. Como `off` é o **padrão**, hoje um usuário do app que digita texto livre ("como estou hoje?") recebe só "Não entendi. Digite ajuda…". Antes, esse texto ia ao Selah legado, com consentimento e crédito. Esse comportamento some no app em qualquer deploy que não tenha `ASSISTANT_AI_MODE=fallback`. O WhatsApp não é afetado (nunca desviava).

Alternativa que satisfaz os dois pontos: manter o desvio condicionado a `reply.unrecognized`. Esse flag só existe em `off`; em `fallback` ele nunca vem, então o frontend não precisa saber o modo. Isso reverteria o item 7.1 do brief e inverteria dois testes do frontend. Não alterei porque o contrato é explícito no §4. **O dono precisa escolher:** (a) manter como está e documentar que o app só tem IA com `fallback`, ou (b) restaurar o desvio condicionado.

## Lacunas de teste fechadas (sobreviventes que viraram testes)

| Mutante | Teste novo |
|---|---|
| B9 timeout inválido (`abc`, `0`, `-5`) não voltava ao padrão 15 s | `it.each` em `assistant.service.spec.ts` |
| B10 qualquer erro do `assertCanAskSelah` virava `blocked_by_plan` | teste: erro que não é `PlanLimitException` sobe e não chama IA nem cobra |
| B11 consentimento checava só `aiAssistantEnabled`, não `aiAssistantConsentAt` | teste com `consentAt: null` (o helper `buildPrismaService` usa `??` e mascarava o `null`) |
| C17 texto vazio chamava a IA | teste: `'   '` → ajuda `unrecognized`, evento `UNRECOGNIZED`, IA não chamada |
| C20 modo ausente na config contava como fallback (`!== 'off'`) | teste: modo `undefined` = off |
| C22 a IA recebia `input.text` sem aparar | teste: recebe texto aparado e o `userId` do dono |
| F7 timers dos estágios não eram cancelados no fim; o aviso podia reaparecer depois da resposta | teste fakeAsync: resposta aos 300 ms + 6 s de espera, nenhum aviso preso |
| F14 o campo da pergunta só era limpo se não fosse `aiFallback` | teste: campo limpo após resposta do fallback |
| D2, D3 (mutantes da trava de D-1) | testes de D-1: reentrega em voo, trava por usuário, liberação ao fim e em erro |

Teste novo de isolamento (item de fechamento do contrato §6): dois usuários com resumos distintos. O corpo enviado ao Selah para o usuário B contém só os dados de B (nada de "Alice", nem do título da meta de A) e nenhuma chave de ação/ferramenta/escrita (`assistant.service.spec.ts`).

## Mutantes

Backend (suítes `src/conversation`, `src/assistant`, `src/whatsapp`; 731 testes na linha de base):

| # | Mutante | Resultado |
|---|---|---|
| B1 | trocar a ordem consentimento × plano | MORTO |
| B2 | remover `recordSelahQuestion` | MORTO |
| B3 | cobrar crédito no caminho `unavailable` | MORTO |
| B4 | cobrar 2× | MORTO |
| B5 | `buildLocalReply` quando a IA falha | MORTO |
| B6 | timeout legado no lugar do de fallback (`undefined`) | MORTO |
| B7 | `askSelah` ignora o `timeoutMs` | MORTO |
| B8 | padrão do fallback 50000 | MORTO |
| B9 | timeout inválido não cai no padrão | SOBREVIVENTE → teste → MORTO |
| B10 | erro qualquer vira `blocked_by_plan` | SOBREVIVENTE → teste → MORTO |
| B11 | consentimento sem `aiAssistantConsentAt` | SOBREVIVENTE → teste → MORTO |
| B12 | sem `privacyNoticeAcceptedAt` | MORTO |
| B13 | `originModule` diferente de `general` | MORTO |
| B14 | `getSummary` de outro usuário | MORTO |
| B15 | `recordSelahQuestion` de outro usuário | MORTO |
| B16 | retornar `answer` sem `trim` | EQUIVALENTE: `normalizeSelahReply` já aplica `trim`, então o `.trim()` do `tryFallbackAnswer` é redundante |
| C1 | bloqueado usa `REPLIES.unrecognized` | MORTO |
| C2 | `no_consent` usa `aiFallbackBlocked` | MORTO |
| C3 | `answered` com `unrecognized: true` | MORTO |
| C4 | `answered` sem `aiFallback` | MORTO |
| C5 | `blocked`/`no_consent` com `unrecognized: true` | MORTO |
| C6 | `unavailable` com `unrecognized: true` | MORTO |
| C7 | gravar `UNRECOGNIZED` além do `ai_fallback` (2 eventos) | MORTO |
| C8 | segundo evento no mesmo caminho `unavailable` | MORTO |
| C9 | não tratar a exceção de `tryFallbackAnswer` no motor | MORTO |
| C10 | log com mensagem do erro e texto do usuário | MORTO |
| C11 | exceção vira `AI_BLOCKED` | MORTO |
| C12 | outcome errado em `answered` | MORTO |
| C13 | `unavailable` com outcome `AI_BLOCKED` | MORTO |
| C14 | `no_consent` com outcome `AI_UNAVAILABLE` | MORTO |
| C15 | palavra de controle chama a IA | MORTO |
| C16 | modo `off` chama a IA | MORTO |
| C17 | texto vazio chama a IA | SOBREVIVENTE → teste → MORTO |
| C18 | `off` sem `unrecognized` | MORTO |
| C19 | `off` sem evento `UNRECOGNIZED` | MORTO |
| C20 | modo `!== 'off'` | SOBREVIVENTE → teste → MORTO |
| C21 | IA recebe `userId` errado | MORTO |
| C22 | IA recebe `input.text` não aparado | SOBREVIVENTE → teste → MORTO |
| C23 | aporte sem meta ignora `handleUnrecognized` | MORTO |
| C24 | `handleWithoutSession` sempre com `controlWord=false` | MORTO |
| C25 | `answered` com state ≠ IDLE | MORTO |
| C26 | `answered` com kind `HELP` | MORTO |
| C27 | `answered` cria sessão (escrita) | MORTO |
| C28 | `answered` chama `transactions.create` | MORTO |
| D1 | sem trava em voo (D-1) | MORTO |
| D2 | trava nunca liberada | SOBREVIVENTE → teste → MORTO |
| D3 | chave da trava sem `userId` | SOBREVIVENTE → teste → MORTO |

Frontend (`assistant-page`, 61 testes na linha de base):

| # | Mutante | Resultado |
|---|---|---|
| F1 | reverter o remove do desvio `askSelah` | MORTO |
| F2 | inverter `manualCard`/`manualBubble` | MORTO |
| F3 | `aiFallback` sempre false | MORTO |
| F4 | estágio de 3 s → 4 s | MORTO |
| F5 | estágio de 5 s → 6 s | MORTO |
| F6 | estágio de 250 ms → 500 ms | MORTO |
| F7 | timers não cancelados no fim | SOBREVIVENTE → teste → MORTO |
| F8 | hint não zerado no fim | MORTO |
| F9 | estágio de 5 s sem "Pode demorar um pouco." | MORTO |
| F10 | oferecer retry com a requisição em voo (botão aos 5 s) | MORTO |
| F11 | balão sem texto | MORTO |
| F12 | hint não renderiza | MORTO |
| F13 | sessão restaurada com `aiFallback: true` | MORTO |
| F14 | limpar o campo só se não for `aiFallback` | SOBREVIVENTE → teste → MORTO |
| F15 | reenvio com `messageId` novo | MORTO |

Totais: **62 mutantes** (B 16, C 28, D 3, F 15). **51 mortos de primeira; 10 sobreviventes que viraram testes e agora morrem (B9, B10, B11, C17, C20, C22, D2, D3, F7, F14); 1 equivalente (B16).** O teste de isolamento de payload e os testes de D-1 foram adicionados além disso.

## Estado final das suítes (após minhas mudanças)

- Backend: `npx tsc --noEmit` limpo; `npx jest` completo: **62 suites / 1683 testes passando** (antes 1672).
- Frontend: `tsc -p tsconfig.app.json` limpo; karma completo: **355 testes passando** (antes 353).
- Arquivos que alterei (não commitados): `backend/src/conversation/conversation.service.ts` (trava D-1), `backend/src/conversation/conversation.service.spec.ts`, `backend/src/assistant/assistant.service.spec.ts`, `frontend/.../assistant-page.component.spec.ts`.

## NÃO verificado

- Trava de reentrega só vale por processo: com mais de uma instância sem afinidade, a janela de cobrança dupla continua. Fechar de vez exigiria reservar o `messageId` no banco antes da IA (valor transitório no enum), o que muda o contrato; não feito.
- Decisão D-2 (modo `off` no app) pendente do dono.
- Migration `20261119120000_ai_fallback_outcomes` não aplicada nem executada contra banco (proibido); só conferida por leitura. O `ADD VALUE` do Postgres em transação exige PG ≥ 12; versão do banco de produção não conferida.
- Indicador de digitação no WhatsApp: fora da fatia (já registrado no contrato).
- Comportamento real contra o SelahIA de verdade (latência, 15 s, formato do `answer`): nenhum teste end-to-end; só `postJson` espionado.
- Fixture de isolamento (`isolation.fixture.ts`) usa o assistente fake sempre `unavailable` e modo `off`: o fallback não é exercitado nas suítes `isolation.spec.ts` (conversation e whatsapp); a cobertura de isolamento do fallback está no spec do `AssistantService` e do motor.
- Cleanup no `onDestroy` do componente (`clearManualHintTimers`): sem mutante dedicado.
- Rate limit/throttle do endpoint de mensagens com a chamada de IA de até 15 s: não analisado.
