# Contrato do item 7: fallback de IA por plano, sem escrita por IA

Data: 2026-11-19. Base: spec `2026-11-14-assistente-manual-financas.md` (estado `FALLBACK`, seção "Carregamento e timeout", ordem de implementação item 7) e plano `2026-11-14-assistente-manual-importacao-planos.md` (decisões 1, 2, 5 e 7 do dono). Branch: `feat/fallback-ia-item-7` (base `develop` `5bb7ed5`+).

## 1. Configuração única (decisão 2 do dono)

- Env novo `ASSISTANT_AI_MODE` com dois valores: `off` (padrão) e `fallback`. entra em `app.config.ts` como `app.assistantAiMode`; `.env.example` documenta.
- `off`: comportamento exatamente como hoje — mensagem não reconhecida devolve ajuda curta com `unrecognized: true`, nenhuma chamada nova a serviço externo.
- `fallback`: o PRÓPRIO MOTOR resolve o não reconhecido (estado `FALLBACK` da spec). O app e o WhatsApp passam a receber a resposta final na mesma resposta do `handleMessage`; nenhum canal decide sozinho quem chama a IA.

## 2. Fluxo do fallback (motor, nos dois pontos que hoje marcam `unrecognized: true`)

Ordem de checagem, sempre antes de qualquer chamada externa:

1. **Consentimento/privacidade** (mesmos gates do `AssistantService.ask`: `privacyNoticeAcceptedAt`, `aiAssistantEnabled`, `aiAssistantConsentAt`): faltando qualquer um, NÃO chama IA → resposta de ajuda contextual, evento com outcome `AI_BLOCKED`.
2. **Crédito do plano**: `EntitlementsService.assertCanAskSelah` (com `BILLING_ENABLED=false` não há limite, como no resto do produto). Bloqueado → NÃO chama IA → ajuda contextual com texto extra de limite ("As perguntas com IA do seu plano já acabaram neste mês.") e `resetsAt` não é exposto, evento `AI_BLOCKED`.
3. **IA**: chamada pelo `AssistantService` — única camada que fala com o SelahIA (regra do repo). Método novo `tryFallbackAnswer(userId, question)` que replica os gates do `ask()` sem lançar exceção e devolve `'answered' | 'blocked_by_plan' | 'no_consent' | 'unavailable'` (com `text` quando respondido).
   - Timeout próprio `SELAH_FALLBACK_TIMEOUT_MS` (padrão 15000). Os 50 s do assistente legado não valem aqui.
   - Respondido → resposta `kind 'INFO'`, `state 'IDLE'`, `text` = resposta da IA, flag `aiFallback: true`; `recordSelahQuestion` UMA vez; evento `AI_ANSWERED`.
   - IA indisponível/erro/payload inválido/integração desligada → ajuda contextual, **sem cobrar crédito**, sem inventar resposta, evento `AI_UNAVAILABLE`.

Regras transversais:

- A resposta do fallback **não** traz `unrecognized` (a decisão saiu do canal). Em `off`, o campo continua como hoje por compatibilidade.
- Métrica agregada (decisão 5 do dono): **um único** `ConversationEvent` por `messageId`, `intent 'ai_fallback'`, outcome `AI_ANSWERED | AI_BLOCKED | AI_UNAVAILABLE` (valores novos no enum, migration aditiva). Isso mantém a proteção de duplicidade por `messageId` que o evento `UNRECOGNIZED` dava.
- O texto bruto da mensagem continua fora do evento (padrão atual do motor).

## 3. A IA nunca escreve

- O payload do fallback é o `buildSelahPayload` atual (somente leitura de contexto) — nenhuma ferramenta de escrita, nenhuma intenção nova gravada.
- O caminho do fallback não cria rascunho, não cria sessão, não toca em confirmar/cancelar e não chama nenhum serviço de escrita de domínio (`TransactionsService.create`, `GoalsService`, `EnvelopesService`, recorrências, parcelados, teto). Confirmado por teste com espiões e por mutantes.
- Só o campo `answer` do payload do Selah é usado; o resto (ações, sugestões) é descartado.

## 4. App (frontend)

- `sendManual` deixa de rotejar `unrecognized` para `askSelah`: quem decide é o motor. Caixa livre legado (pergunta com consentimento) não muda.
- Resposta com `aiFallback: true` aparece como balão de texto simples (kind `INFO`), sem cartão.
- Carregamento (spec "Carregamento e timeout"): aos 250 ms "Consultando seus dados…" (existe); aos 3 s vira "Organizando a resposta…"; aos 5 s acrescenta "Pode demorar um pouco." Desvio aceito da spec: a "nova tentativa" de 5 s só é oferecida quando a requisição falha (reenvio com o MESMO `messageId`, decisão 5) — oferecer retry com a chamada em voo duplicaria cobrança de crédito.
- Erro de rede/5xx/429 no fallback segue o caminho de erro atual do manual (não cai em IA).

## 5. WhatsApp

- Mesmo motor, mesmo fallback: o adaptador já formata qualquer `ConversationReply` como texto (`formatReplyForWhatsapp`). Nenhuma mudança no adaptador além do que o tipo novo exigir.
- Indicador de digitação: fora desta fatia (suporte do WA-AKG não verificado). Registrado em NÃO verificado.

## 6. Itens de fechamento

- Refazer o "teste do prompt de fallback isolado" da revisão do item 6: provar que o payload enviado ao Selah no fallback só contém dados do dono autenticado e que nada no caminho chama escrita (condição registrada em `.superpowers/sdd/isolamento-item-6/resultado-6.md`).
- Matriz mínima da spec coberta: "fallback bloqueado sem plano/crédito e nunca capaz de gravar"; app e WhatsApp com o mesmo comportamento para a mesma mensagem.
