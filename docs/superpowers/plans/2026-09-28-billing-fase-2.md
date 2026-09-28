# Billing do Lumen — Fase 2 (cobrança de verdade) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar a cobrança de verdade do plano Individual via Asaas: assinar (checkout hospedado), confirmar por webhook, sincronizar como rede de segurança, cancelar e recuperar de um cartão recusado — tudo sobre o núcleo já existente (catálogo, `EntitlementsService`, `Subscription`/`BillingEvent`) da Fase 0/1.

**Architecture:** Um `AsaasClient` fino (HTTP cru, sem lib nova, no padrão já usado por `MailService`) isola toda chamada ao Asaas. Um novo `BillingPaymentsService` cobre assinar/cancelar/sincronizar/processar webhook, com uma única função interna (`reconcileSubscription`) que deriva o estado local (ACTIVE/PAST_DUE/CANCELED) só a partir de dois campos confirmados no spike (`deleted`, `nextDueDate`) — assim webhook e sincronizar nunca podem divergir em comportamento, e nenhuma parte do código depende de um valor de `status` do Asaas que não foi verificado.

**Tech Stack:** NestJS 11 + Prisma 5.22 (backend), Angular 20 standalone + Signals (frontend), Node `http`/`https` cru para o cliente Asaas (mesmo padrão de `MailService`/`AssistantService`), Jest (unitário e E2E de harness), Asaas sandbox (`https://api-sandbox.asaas.com/v3`).

**Spec:** `docs/superpowers/specs/2026-09-27-billing-design.md` (seções 5, 6, 8, 9, 10, 11, 12, 13, 14 — a spec viaja com o plano, leia as duas).

## Global Constraints

- `POST /billing/checkout` recusa com `400` quando `app.billingEnabled` (via `ConfigService`) é `false` — nunca criar um checkout real com a cobrança desligada. `sync`, `cancel` e o processamento de webhook **não** checam a flag (podem existir assinaturas reais mesmo com a flag temporariamente desligada, ex. rollback; precisam continuar reconciliáveis).
- Checkout `RECURRENT`: `billingTypes: ["CREDIT_CARD"]` apenas (confirmado no spike — Pix dá `400`), **sem** `customerData` (mandar parcial dá `400`; omitir deixa o Asaas coletar tudo na página dele), `minutesToExpire: 60`, `externalReference` = id (uuid) da `Subscription` local criada antes da chamada.
- Preço vem sempre de `getCatalog()[plan].prices[interval]` no servidor — nunca do corpo da requisição do cliente.
- `AsaasClient`: header de autenticação é `access_token: <ASAAS_API_KEY>` (não `Authorization: Bearer`, confirmado no spike). Timeout de 10s por chamada. Retry: até 2 tentativas com backoff só em erro de rede/timeout/5xx; erro 4xx nunca repete.
- Webhook (`POST /billing/webhooks/asaas`, `@Public()`): compara o header `asaas-access-token` com `ASAAS_WEBHOOK_TOKEN` por `timingSafeEqual` com checagem de tamanho antes (padrão de `email-preferences.service.ts:29-41`); token inválido = `401`, sem gravar nada. Idempotência por `BillingEvent.externalEventId` (= `payload.id`): evento já com `processedAt` preenchido = `200` sem reprocessar; evento gravado mas sem `processedAt` (falha anterior) = tenta de novo; evento novo = grava e processa. Falha ao processar = deixa o `500` subir (Asaas reenvia).
- `AsaasClient` nunca ganha um método de reembolso — reembolso continua manual pelo painel do Asaas (decisão já tomada); o backend só reage a `PAYMENT_REFUNDED`.
- Limites de taxa (adicionar em `RateLimitGuard`, mesmo padrão das políticas existentes): `POST /billing/checkout` 5/hora por usuário (spec §9); `POST /billing/sync` 10/hora por usuário (spec §9); `POST /billing/webhooks/asaas` 300 a cada 5 minutos por IP (sem número fixo na spec — valor deste plano, generoso o bastante para rajadas legítimas de reenvio do Asaas sem abrir a porta pra abuso; usa o fallback padrão do guard, que sem usuário autenticado já cai em `ipAddress`).
- Fora do escopo desta fase (spec §15): trocar intervalo mensal↔anual, reembolso self-service, textos legais e preço na landing.

## Review Focus

1. Duas chamadas seguidas a `POST /billing/checkout` do mesmo usuário reaproveitam o mesmo checkout `PENDING` não expirado em vez de abrir um segundo no Asaas — checar na Task 3.
2. O mesmo evento de webhook entregue duas vezes (o Asaas reenvia "pelo menos uma vez") não aplica o efeito duas vezes — checar na Task 4.
3. Webhook com `asaas-access-token` ausente ou errado devolve `401` e não grava `BillingEvent` nenhum — checar na Task 4.
4. `POST /billing/cancel` de um usuário sem assinatura Asaas (só Grátis, ou só concessão de fundador) devolve um erro claro, não um 500 nem cancela a concessão — checar na Task 6.
5. `POST /billing/checkout` para o plano `SHARED` (não `sellable`) ou com `BILLING_ENABLED=false` devolve `400` sem chamar o Asaas — checar na Task 3.

---

### Task 1: Schema — campos novos na `Subscription`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_billing_checkout_fields/migration.sql`

**Interfaces:**
- Produces: `Subscription.asaasCheckoutLink String?` (link do checkout hospedado, guardado pra reaproveitar num reenvio); `Subscription.latestInvoiceUrl String?` (fatura mais recente conhecida, vem direto do payload do webhook — usada em "Regularizar pagamento" no `PAST_DUE`).

- [ ] **Step 1: Adicionar os dois campos** em `model Subscription` no `schema.prisma`, logo após `asaasCustomerId`.
- [ ] **Step 2: Escrever a migration SQL** à mão (`ALTER TABLE "Subscription" ADD COLUMN "asaasCheckoutLink" TEXT, ADD COLUMN "latestInvoiceUrl" TEXT;`), no padrão das migrations vizinhas.
- [ ] **Step 3: Verificar.** Com Postgres do harness migrado até a migration anterior: `DATABASE_URL=... npx prisma migrate deploy && npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`. Esperado: aplica a nova migration e o `diff` sai com código 0.
- [ ] **Step 4:** `npx prisma generate && npx tsc --noEmit` — sem erros.
- [ ] **Step 5: Commit** — `feat(billing): campos de checkout e fatura na Subscription`.

### Task 2: Configuração do Asaas e `AsaasClient`

**Files:**
- Create: `backend/src/config/asaas.config.ts`, `backend/src/config/asaas.config.spec.ts`, `backend/src/billing/asaas-client.ts`, `backend/src/billing/asaas-client.spec.ts`
- Modify: `backend/src/app.module.ts` (adicionar `asaasConfig` ao `load` do `ConfigModule`), `backend/src/billing/billing.module.ts` (prover/exportar `AsaasClient`), `.env.example`, `.env.production.example`, `docker-compose.yml`, `docker-compose.prod.yml`

**Interfaces:**
- Produces:
```ts
// asaas.config.ts — registerAs('asaas', ...), mesmo padrão de mail.config.ts
{ apiKey: string; baseUrl: string; webhookToken: string; timeoutMs: number }
// default de asaas.baseUrl: 'https://api-sandbox.asaas.com/v3'; default de asaas.timeoutMs: 10000

// asaas-client.ts
export interface AsaasCheckout { id: string; link: string }
export interface AsaasSubscription {
  id: string;
  deleted: boolean;
  nextDueDate: string;      // ISO date (YYYY-MM-DD), vem cru do Asaas
  externalReference: string | null;
}
export interface CreateCheckoutParams {
  value: number;
  cycle: 'MONTHLY' | 'YEARLY';
  externalReference: string;
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
  minutesToExpire: number;
}

@Injectable()
export class AsaasClient {
  createCheckout(params: CreateCheckoutParams): Promise<AsaasCheckout>;
  getSubscription(id: string): Promise<AsaasSubscription>;
  findSubscriptionByExternalReference(ref: string): Promise<AsaasSubscription | null>;
  deleteSubscription(id: string): Promise<void>;
}
```

- [ ] **Step 1: Teste de config** (`asaas.config.spec.ts`, mesmo estilo de `mail.config.spec.ts`/`app.config.spec.ts` se existir): sem env, `baseUrl` cai no sandbox e `timeoutMs` em `10000`; com `ASAAS_API_KEY`/`ASAAS_BASE_URL`/`ASAAS_WEBHOOK_TOKEN`/`ASAAS_TIMEOUT_MS` setados, cada um é lido.
- [ ] **Step 2: Rodar** `npx jest src/config/asaas.config.spec.ts` — FAIL. **Step 3: Implementar** `asaas.config.ts` (mesmo formato de `mail.config.ts`, sem `parseBoolean` — não tem flag aqui, a flag geral é `app.billingEnabled`).
- [ ] **Step 4: Testes do `AsaasClient`** (`asaas-client.spec.ts`, espionando o método privado de request como em `mail.service.spec.ts`): `createCheckout` monta `POST {baseUrl}/checkouts` com header `access_token` e o corpo de `CreateCheckoutParams` (incluindo `billingTypes:['CREDIT_CARD']`, `subscription:{cycle, value}` fixos internamente — não vêm do chamador), devolve `{id, link}` do corpo da resposta; `getSubscription` faz `GET {baseUrl}/subscriptions/{id}` e devolve `{id, deleted, nextDueDate, externalReference}`; `findSubscriptionByExternalReference` faz `GET {baseUrl}/subscriptions?externalReference={ref}` e devolve `data[0]` mapeado, ou `null` se `data` vier vazio; `deleteSubscription` faz `DELETE {baseUrl}/subscriptions/{id}`; uma resposta 5xx é tentada de novo (até 2x) e uma 4xx não é; timeout dispara `AsaasClientError` (classe nova, exportada) sem retry.
- [ ] **Step 5: Rodar** — FAIL. **Step 6: Implementar** `AsaasClient` com um método privado `request<T>(method, path, body?)` (padrão de `mail.service.ts:656-696`, usando `http`/`https` conforme o protocolo do `baseUrl`) e os 4 métodos públicos por cima dele.
- [ ] **Step 7: Rodar os specs novos + `npx tsc --noEmit`** — PASS. Registrar `AsaasClient` em `billing.module.ts` (`providers`/`exports`). Adicionar ao `ConfigModule.load` em `app.module.ts`.
- [ ] **Step 8:** Adicionar `ASAAS_API_KEY=`, `ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3`, `ASAAS_WEBHOOK_TOKEN=`, `ASAAS_TIMEOUT_MS=10000` em `.env.example`, `.env.production.example` (mesmo bloco de `BILLING_*`) e como passthrough em `docker-compose.yml`/`docker-compose.prod.yml` (mesmo padrão de `RESEND_*`).
- [ ] **Step 9: Commit** — `feat(billing): configuracao do Asaas e AsaasClient`.

### Task 3: `POST /billing/checkout`

**Files:**
- Create: `backend/src/billing/dto/create-checkout.dto.ts`, `backend/src/billing/billing-payments.service.ts`, `backend/src/billing/billing-payments.service.spec.ts`
- Modify: `backend/src/billing/billing.controller.ts`, `backend/src/billing/billing.module.ts`, `backend/src/common/guards/rate-limit.guard.ts`, `backend/src/common/guards/rate-limit.guard.spec.ts`

**Interfaces:**
- Consumes: `AsaasClient.createCheckout` (Task 2); `getCatalog`, `PLAN_RANK` (`plans.catalog.ts`); `pickEffectivePlan`/`subscriptionGrantsAccess` (`access.util.ts`); `app.frontendUrl`, `app.billingEnabled` (`ConfigService`).
- Produces:
```ts
// create-checkout.dto.ts
export class CreateCheckoutDto {
  plan: 'INDIVIDUAL' | 'SHARED';   // @IsIn(['INDIVIDUAL','SHARED'])
  interval: 'MONTHLY' | 'YEARLY';  // @IsIn(['MONTHLY','YEARLY'])
}

// billing-payments.service.ts
@Injectable()
export class BillingPaymentsService {
  checkout(userId: string, dto: CreateCheckoutDto): Promise<{ link: string }>;
}
```
- Later tasks (4, 5, 6) add mais métodos a esta mesma classe.

- [ ] **Step 1: Testes** (mock de `PrismaService` e `AsaasClient` via `{ createCheckout: jest.fn()... } as any`, mesmo estilo de `entitlements.service.spec.ts`):
  - `BILLING_ENABLED` falso → rejeita com `BadRequestException`, `asaasClient.createCheckout` nunca chamado (Review Focus 5).
  - Plano `SHARED` (`sellable:false`) → rejeita com `BadRequestException`, `asaasClient.createCheckout` nunca chamado (Review Focus 5).
  - Usuário já com `Subscription` `ACTIVE` (`source:'ASAAS'`) de plano igual → rejeita com `BadRequestException`, `asaasClient.createCheckout` nunca chamado.
  - Usuário já com `Subscription` `PAST_DUE` (`source:'ASAAS'`) de plano igual → rejeita do mesmo jeito (ainda tem acesso pela tolerância de atraso, não faz sentido abrir outro checkout).
  - Usuário já com concessão `GRANT` `ACTIVE` de plano igual ou maior → rejeita do mesmo jeito.
  - Usuário com `Subscription` `CANCELED` (dentro do `currentPeriodEnd`, ainda com acesso pela regra de `access.util.ts`) → **não** rejeita, segue pro checkout normal (quem cancelou pode assinar de novo antes do fim do período).
  - Usuário com `Subscription` `PENDING` (`source:'ASAAS'`) criada há 10 minutos com `asaasCheckoutLink` preenchido → devolve esse link sem chamar `asaasClient.createCheckout` (Review Focus 1).
  - Usuário com `Subscription` `PENDING` criada há 90 minutos (passou dos 60 de `minutesToExpire`) → chama `asaasClient.createCheckout` e cria uma `Subscription` nova.
  - Caminho feliz (sem nada pendente): cria `Subscription` `PENDING` primeiro, chama `createCheckout` com `externalReference` igual ao `id` dessa linha e `value` vindo do catálogo (`getCatalog().INDIVIDUAL.prices.MONTHLY` etc.) para o `plan`/`interval` pedidos, depois grava `asaasCheckoutId`/`asaasCheckoutLink` na mesma linha e devolve `{link}`.
- [ ] **Step 2: Rodar** `npx jest src/billing/billing-payments.service.spec.ts` — FAIL.
- [ ] **Step 3: Implementar `checkout()`** seguindo a ordem de checagens do Global Constraints/spec §8: flag → `sellable` → alguma `Subscription` (qualquer `source`) com `status IN ('ACTIVE','PAST_DUE')` e `PLAN_RANK[plan] >= PLAN_RANK[dto.plan]` → checkout `PENDING` reaproveitável → cria novo. Note que `CANCELED` **não** entra nessa checagem (mesmo ainda com acesso pela regra de `access.util.ts`) — só bloqueia quem tem algo de fato em cobrança. `callback` usa `app.frontendUrl` + `/plano?checkout=sucesso|cancelado|expirado`.
- [ ] **Step 4: Rodar os testes + `npx tsc --noEmit`** — PASS.
- [ ] **Step 5:** Adicionar `POST billing/checkout` em `billing.controller.ts` (autenticado, `@Body() dto: CreateCheckoutDto`, chama `billingPaymentsService.checkout(user.sub, dto)`). Registrar `BillingPaymentsService` em `billing.module.ts`.
- [ ] **Step 6:** Em `rate-limit.guard.ts`, adicionar `billingCheckoutPolicy` (`keyPrefix:'billing-checkout', limit:5, windowMs:60*60_000`) e o `if (method==='POST' && path==='/api/v1/billing/checkout')` em `resolvePolicy`. Teste em `rate-limit.guard.spec.ts`: 6ª chamada no mesmo balde dá `429`.
- [ ] **Step 7: Rodar a suíte completa + `npx tsc --noEmit` + `npx nest build`** — PASS.
- [ ] **Step 8: Commit** — `feat(billing): endpoint de checkout com prevencao de duplicado`.

### Task 4: Webhook — token, idempotência e ativação (`CHECKOUT_PAID`)

**Files:**
- Modify: `backend/src/billing/billing-payments.service.ts`, `backend/src/billing/billing-payments.service.spec.ts`, `backend/src/billing/billing.controller.ts`, `backend/src/common/guards/rate-limit.guard.ts`, `backend/src/common/guards/rate-limit.guard.spec.ts`

**Interfaces:**
- Consumes: `AsaasClient.getSubscription` (Task 2).
- Produces:
```ts
// billing-payments.service.ts — acrescenta:
processWebhookEvent(token: string | undefined, payload: Record<string, unknown>): Promise<void>;
```
Lança `UnauthorizedException` (token inválido) ou `BadRequestException` (payload sem `id`/`event` string). Sucesso não devolve nada (o controller responde 2xx vazio).

- [ ] **Step 1: Testes:**
  - Sem header, ou header diferente do `ASAAS_WEBHOOK_TOKEN` configurado → `UnauthorizedException`; nenhuma linha gravada em `BillingEvent` (Review Focus 3).
  - Payload sem `id` ou sem `event` (string) → `BadRequestException`.
  - Evento com `id` que já existe em `BillingEvent` com `processedAt` preenchido → devolve sem erro, `asaasClient.getSubscription` nunca chamado (Review Focus 2).
  - Evento `CHECKOUT_PAID` com `checkout.id` que bate com o `asaasCheckoutId` de uma `Subscription` local: grava `asaasSubscriptionId`/`asaasCustomerId` (de `checkout.subscription`/`checkout.customer`) nessa linha, chama `asaasClient.getSubscription` com o `asaasSubscriptionId`, e — como o `nextDueDate` devolvido é uma data no futuro e a linha não tinha `currentPeriodEnd` — grava `status:'ACTIVE'`, `currentPeriodEnd` = esse `nextDueDate`. Ao fim, a linha em `BillingEvent` fica com `processedAt` preenchido.
  - Evento `CHECKOUT_PAID` cujo `checkout.id` não bate com nenhuma `Subscription` local: não lança erro (grava o evento como processado, loga um aviso, `asaasClient.getSubscription` nunca chamado).
  - Evento de tipo desconhecido (ex. `SPLIT_CREATED`): não lança erro, grava `BillingEvent` com `processedAt` preenchido, nenhuma `Subscription` tocada.
- [ ] **Step 2: Rodar** — FAIL.
- [ ] **Step 3: Implementar.** Verificação do token: `Buffer.from(header ?? '')` vs `Buffer.from(configuredToken)`, comparar `.length` antes de `timingSafeEqual` (padrão de `email-preferences.service.ts:29-41`). Sanitização: função `sanitizeWebhookPayload(payload)` que remove recursivamente chaves sensíveis conhecidas (`creditCard`, `creditCardHolderInfo`, `cpfCnpj`, `postalCode`, `address`, `addressNumber`, `phoneNumber`) se algum dia aparecerem — hoje os payloads confirmados no spike não as têm, mas a função protege se o Asaas enriquecer o payload depois. Idempotência: tentar `prisma.billingEvent.create({data:{externalEventId: payload.id, type: payload.event, payload: sanitized}})`; se o `id` já existe, `findUnique` e checar `processedAt` (presente = retorna; ausente = segue pra reprocessar sem criar de novo). Dispatch por `payload.event`; implementar aqui só o caso `CHECKOUT_PAID` (chama o método privado `reconcileSubscription` — ver próximo passo) e o caso "desconhecido" (`default: apenas loga`); os outros tipos de evento ganham `default` por enquanto (tratados na Task 5). Ao final de qualquer caminho que não lançou, gravar `processedAt: new Date()` no `BillingEvent`.
- [ ] **Step 4: Implementar `private async reconcileSubscription(local: Subscription): Promise<void>`**: busca `asaasClient.getSubscription(local.asaasSubscriptionId)`; se `deleted` → `status:'CANCELED'`; senão, se `nextDueDate` (convertido pra `Date`) é depois do `local.currentPeriodEnd` atual (ou `local.currentPeriodEnd` é `null`) → `status:'ACTIVE'`, `currentPeriodEnd: nextDueDate`, `pastDueSince: null`; senão → `status:'PAST_DUE'`, `pastDueSince: local.pastDueSince ?? new Date()` (só grava a primeira vez que entra em atraso).
- [ ] **Step 5: Rodar os testes + `npx tsc --noEmit`** — PASS.
- [ ] **Step 6:** Adicionar `POST billing/webhooks/asaas` em `billing.controller.ts`: `@Public()`, `@Headers('asaas-access-token') token`, `@Body() payload: Record<string, unknown>`, chama `processWebhookEvent`.
- [ ] **Step 7:** Em `rate-limit.guard.ts`, `billingWebhookPolicy` (`keyPrefix:'billing-webhook', limit:300, windowMs:5*60_000`) e o `if` de rota em `resolvePolicy` para `POST /api/v1/billing/webhooks/asaas`. Sem usuário autenticado nessa rota, `resolveActorKey` já cai em `ipAddress` pelo `return userId || ipAddress;` padrão — nenhuma mudança extra ali.
- [ ] **Step 8: Rodar a suíte completa + `npx tsc --noEmit` + `npx nest build`** — PASS.
- [ ] **Step 9: Commit** — `feat(billing): endpoint de webhook com token, idempotencia e ativacao por checkout pago`.

### Task 5: Webhook — pagamento, cancelamento, reembolso e `latestInvoiceUrl` em `/billing/me`

**Files:**
- Modify: `backend/src/billing/billing-payments.service.ts`, `backend/src/billing/billing-payments.service.spec.ts`, `backend/src/billing/billing.service.ts`, `backend/src/billing/billing.service.spec.ts`

**Interfaces:**
- Consumes: `reconcileSubscription` (Task 4, já privado na mesma classe).
- Produces: `BillingMe.latestInvoiceUrl: string | null` (novo campo, em `billing.service.ts`) — usado pela Task 9 pra mostrar "Regularizar pagamento".

- [ ] **Step 1: Testes**, todos partindo de uma `Subscription` local `ACTIVE` já com `asaasSubscriptionId`:
  - `PAYMENT_CONFIRMED` (e, num segundo teste, `PAYMENT_RECEIVED`) com `payment.subscription` igual ao `asaasSubscriptionId` local e `payment.invoiceUrl` preenchido: `asaasClient.getSubscription` é chamado, a linha local é atualizada (`reconcileSubscription`) e `latestInvoiceUrl` recebe o `payment.invoiceUrl` do payload.
  - `PAYMENT_OVERDUE` com o mesmo `payment.subscription`: `asaasClient.getSubscription` devolve um `nextDueDate` que **não** avançou em relação ao `currentPeriodEnd` já gravado → linha vira `PAST_DUE` com `pastDueSince` preenchido; `latestInvoiceUrl` também é atualizado a partir do payload.
  - `PAYMENT_REFUNDED` com o mesmo `payment.subscription`: a linha vira `status:'CANCELED'`, `currentPeriodEnd` igual a agora (`new Date()`, tolerância de alguns segundos no teste) — e **sem** chamar `asaasClient.getSubscription` (não precisa: o encerramento é imediato e local).
  - `SUBSCRIPTION_DELETED` (e, num segundo teste, `SUBSCRIPTION_INACTIVATED`) com `subscription.id` igual ao `asaasSubscriptionId` local: chama `asaasClient.getSubscription` (que devolve `deleted:true` no fake do teste) e a linha vira `CANCELED` via `reconcileSubscription`.
  - Qualquer um desses quatro tipos de evento com um id (`payment.subscription` ou `subscription.id`) que não bate com nenhuma `Subscription` local: não lança erro, não chama `asaasClient`, `BillingEvent` fica com `processedAt` preenchido (mesmo comportamento de "desconhecido" da Task 4).
- [ ] **Step 2: Rodar** — FAIL.
- [ ] **Step 3: Implementar** os `case`s que faltavam no dispatch da Task 4: `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`/`PAYMENT_OVERDUE` (acham a linha local por `asaasSubscriptionId = payload.payment.subscription`, gravam `latestInvoiceUrl = payload.payment.invoiceUrl` se vier, chamam `reconcileSubscription`); `PAYMENT_REFUNDED` (acha a linha do mesmo jeito, chama um novo método privado `endAccessNow(local)` que grava `status:'CANCELED', currentPeriodEnd:new Date()` direto, sem tocar no Asaas); `SUBSCRIPTION_DELETED`/`SUBSCRIPTION_INACTIVATED` (acham por `asaasSubscriptionId = payload.subscription.id`, chamam `reconcileSubscription`).
- [ ] **Step 4: Teste em `billing.service.spec.ts`:** `getMe()` de um usuário cuja assinatura efetiva tem `latestInvoiceUrl` gravado devolve esse valor em `BillingMe.latestInvoiceUrl`; sem assinatura efetiva (Grátis), devolve `null`.
- [ ] **Step 5: Rodar** — FAIL. **Step 6: Implementar:** adicionar `latestInvoiceUrl: string | null` à interface `BillingMe` e, em `getMe()`, `latestInvoiceUrl: effective?.latestInvoiceUrl ?? null` (mesma linha de `effective` já usada para `status`/`source`/`currentPeriodEnd`).
- [ ] **Step 7: Rodar os testes + suíte completa + `npx tsc --noEmit` + `npx nest build`** — PASS.
- [ ] **Step 8: Commit** — `feat(billing): webhook trata pagamento, atraso, cancelamento e reembolso`.

### Task 6: `POST /billing/sync` e `POST /billing/cancel`

**Files:**
- Modify: `backend/src/billing/billing-payments.service.ts`, `backend/src/billing/billing-payments.service.spec.ts`, `backend/src/billing/billing.controller.ts`, `backend/src/common/guards/rate-limit.guard.ts`, `backend/src/common/guards/rate-limit.guard.spec.ts`

**Interfaces:**
- Consumes: `AsaasClient.findSubscriptionByExternalReference`, `AsaasClient.deleteSubscription` (Task 2); `reconcileSubscription` (Task 4).
- Produces:
```ts
// billing-payments.service.ts — acrescenta:
sync(userId: string): Promise<void>;
cancel(userId: string): Promise<void>;
```

- [ ] **Step 1: Testes de `sync`:**
  - Usuário sem nenhuma `Subscription` `source:'ASAAS'` → não faz nada, não lança erro.
  - Usuário com `Subscription` `PENDING` (checkout aberto, sem `asaasSubscriptionId` ainda): `findSubscriptionByExternalReference` é chamado com o `id` dessa linha; se devolver uma assinatura real (o "webhook perdido"), grava `asaasSubscriptionId` e chama `reconcileSubscription`; se devolver `null`, não muda nada.
  - Usuário com `Subscription` `ACTIVE` **ou** `PAST_DUE` já com `asaasSubscriptionId` (linha já vinculada, independente do status atual): chama `asaasClient.getSubscription` (não `findSubscriptionByExternalReference`) e aplica `reconcileSubscription` do mesmo jeito que o webhook.
- [ ] **Step 2: Testes de `cancel`:**
  - Usuário sem `Subscription` `source:'ASAAS'` em `ACTIVE`/`PAST_DUE` (só Grátis, ou só `GRANT`) → `NotFoundException`, `asaasClient.deleteSubscription` nunca chamado (Review Focus 4).
  - Usuário com `Subscription` `ASAAS` `ACTIVE`: chama `asaasClient.deleteSubscription(asaasSubscriptionId)` e grava `status:'CANCELED'`, `cancelAtPeriodEnd:true` — `currentPeriodEnd` **não muda** (acesso segue até lá, regra já existente em `access.util.ts`).
  - Chamar `cancel` de novo na mesma assinatura já `CANCELED`: idempotente, não lança erro, não chama `asaasClient.deleteSubscription` de novo.
- [ ] **Step 3: Rodar** — FAIL. **Step 4: Implementar** `sync()` e `cancel()` conforme os testes. Invariante que a Task 3 já garante: um usuário nunca tem mais de uma `Subscription` `source:'ASAAS'` com `status IN ('PENDING','ACTIVE','PAST_DUE')` ao mesmo tempo — então tanto `sync()` quanto `cancel()` buscam com `findFirst({where:{ownerUserId, source:'ASAAS', status:{in:['PENDING','ACTIVE','PAST_DUE']}}})`, sem precisar desempatar entre várias linhas.
- [ ] **Step 5: Rodar os testes + `npx tsc --noEmit`** — PASS.
- [ ] **Step 6:** Adicionar `POST billing/sync` e `POST billing/cancel` em `billing.controller.ts` (autenticados, chamam `user.sub`).
- [ ] **Step 7:** Em `rate-limit.guard.ts`, `billingSyncPolicy` (`keyPrefix:'billing-sync', limit:10, windowMs:60*60_000`) e o `if` de rota para `POST /api/v1/billing/sync` (`cancel` fica na política padrão, não tem limite dedicado na spec).
- [ ] **Step 8: Rodar a suíte completa + `npx tsc --noEmit` + `npx nest build`** — PASS.
- [ ] **Step 9: Commit** — `feat(billing): sincronizar e cancelar assinatura`.

### Task 7: Verificação ponta a ponta do backend (harness, Asaas falso)

**Files:** nenhum arquivo do repo (script descartável no scratchpad, mesmo padrão da Task 8 da Fase 0/1).

- [ ] **Step 1:** Subir o harness (Postgres + backend, portas próprias, checar `ss -ltnp` antes) com `BILLING_ENABLED=true`, `ASAAS_BASE_URL` apontando pra um servidor HTTP local fake que implementa `POST /checkouts` (devolve `{id, link}`), `GET /subscriptions/:id`, `GET /subscriptions?externalReference=`, `DELETE /subscriptions/:id`, `ASAAS_WEBHOOK_TOKEN` de teste.
- [ ] **Step 2: Roteiro:** usuário assina (`POST /billing/checkout`) → recebe `link`; simular a confirmação chamando `POST /billing/webhooks/asaas` com um payload `CHECKOUT_PAID` de mentira (`checkout.id` = o id devolvido pelo fake, `checkout.subscription` = um id de assinatura qualquer) e o token certo → `GET /billing/me` mostra `plan:'INDIVIDUAL', status:'ACTIVE', source:'ASAAS'` (`BillingService.getMe`, Fase 0/1, já devolve o `source` da assinatura que sustenta o plano efetivo). Repetir o mesmo webhook (mesmo `id` de evento) → nada muda, `GET /billing/me` idêntico. Webhook com token errado → `401`. `POST /billing/sync` num usuário sem nada pendente → `200` sem erro. `POST /billing/cancel` → `GET /billing/me` mostra `status:'CANCELED'` e o `DELETE /subscriptions/:id` do fake foi chamado. `POST /billing/checkout` de novo, plano igual, assinatura ainda `CANCELED` mas dentro do `currentPeriodEnd` → **não** bloqueia (só `ACTIVE`/`PAST_DUE` bloqueiam, conferir contra `subscriptionGrantsAccess`). `POST /billing/checkout` com `BILLING_ENABLED=false` → `400` sem tocar no fake.
- [ ] **Step 3:** Encerrar tudo por PID. Sem commit — registrar o resultado na descrição do commit da Task 8.

### Task 8: Frontend — `BillingService.checkout/cancel/sync`

**Files:**
- Modify: `frontend/src/app/core/services/billing.service.ts`, `frontend/src/app/core/services/billing.service.spec.ts`, `frontend/src/app/core/models/domain.models.ts`

**Interfaces:**
- Produces:
```ts
// domain.models.ts — acrescenta a BillingMe:
latestInvoiceUrl: string | null;

// billing.service.ts — acrescenta:
checkout(body: { plan: 'INDIVIDUAL'; interval: 'MONTHLY' | 'YEARLY' }): Observable<{ link: string }>;
cancel(): Observable<void>;
sync(): Observable<void>;
```

- [ ] **Step 1:** Adicionar `latestInvoiceUrl: string | null` à interface `BillingMe` em `domain.models.ts` (mesmo campo novo da Task 5 no backend).
- [ ] **Step 2: Testes** (`HttpTestingController`, mesmo padrão dos métodos já existentes no spec): `checkout` faz `POST {api}/billing/checkout` com o corpo dado e devolve `{link}`; `cancel` faz `POST {api}/billing/cancel` sem corpo; `sync` faz `POST {api}/billing/sync` sem corpo.
- [ ] **Step 3: Rodar** (`CHROME_BIN=... npx ng test --watch=false --browsers=ChromeHeadless --include='**/core/services/billing.service.spec.ts'`) — FAIL. **Step 4: Implementar** os três métodos.
- [ ] **Step 5: Rodar** o spec + `npx tsc --noEmit -p tsconfig.app.json` — PASS.
- [ ] **Step 6: Commit** — `feat(billing): BillingService.checkout/cancel/sync e latestInvoiceUrl no modelo`.

### Task 9: Frontend — `/plano` com assinar, cancelar e regularizar

**Files:**
- Modify: `frontend/src/app/features/billing/plan-page/plan-page.component.{ts,html,scss,spec.ts}`

**Interfaces:**
- Consumes: `BillingService.checkout/cancel/sync` (Task 8); `BillingMe.status`/`source`/`cancelAtPeriodEnd`/`latestInvoiceUrl` (já existem ou vêm da Task 8).

- [ ] **Step 1: Teste** (`plan-page.component.spec.ts`, `BillingService` falso, mesmo padrão da Task 10 da Fase 0/1): clicar "Assinar mensal" chama `checkout({plan:'INDIVIDUAL', interval:'MONTHLY'})` e, ao devolver `{link}`, chama `component.navigateToExternal` (novo método `protected navigateToExternal(url: string) { window.location.href = url; }`, espionado com `spyOn(component as any, 'navigateToExternal')` — não dá pra espionar `window.location.href` direto no Karma, por isso o método existe só pra isolar essa linha); clicar "Cancelar" com confirmação aceita (`window.confirm` espionado devolvendo `true`) chama `cancel()` e, ao terminar, chama `billing.loadMe()` de novo; clicar "Cancelar" com a confirmação recusada (`window.confirm` devolvendo `false`) não chama `cancel()`; com `status:'PAST_DUE'` e `latestInvoiceUrl` no `me()`, mostra o botão "Regularizar pagamento" apontando pro `invoiceUrl`; a rota com `?checkout=sucesso` na URL mostra "Confirmando pagamento…" e chama `sync()` uma vez.
- [ ] **Step 2: Rodar** — FAIL. **Step 3: Implementar:**
  - Botões "Assinar mensal"/"Assinar anual" (visíveis quando `me().plan === 'FREE'`), cada um chama `billing.checkout({plan:'INDIVIDUAL', interval: 'MONTHLY'|'YEARLY'})` e, ao devolver `{link}`, chama `this.navigateToExternal(link)`.
  - Botão "Cancelar" (visível só quando `me().source === 'ASAAS'`; **não** mostrar pra `source === 'GRANT'`, essas não se cancelam por aqui) chama `window.confirm('Cancelar sua assinatura? Você continua com acesso até o fim do período já pago.')`; se `true`, chama `billing.cancel()` e, ao terminar, `billing.loadMe()` de novo; se `false`, não faz nada.
  - Bloco `PAST_DUE`: chip existente + botão "Regularizar pagamento" (`<a [href]="me().latestInvoiceUrl" target="_blank">`, some se `latestInvoiceUrl` for `null`) ao lado de "Cancelar e assinar de novo" (mesmo botão de cancelar).
  - Ler `ActivatedRoute.queryParams` (padrão de `verify-email-page.component.ts`) para `checkout=sucesso|cancelado|expirado`; em `sucesso`, mostrar "Confirmando pagamento…" e chamar `sync()` uma vez seguido de `loadMe()`; em `cancelado`/`expirado`, um toast simples e nada mais (não é erro).
- [ ] **Step 4: Rodar** o spec + `npx ng build` (sem erros nem avisos novos).
- [ ] **Step 5: Verificação visual** com Puppeteer contra o harness da Task 7 (Asaas falso): `/plano` nos três estados (Grátis com botões de assinar, Individual ativo com botão de cancelar, `PAST_DUE` com "Regularizar pagamento"), claro/escuro, desktop/mobile.
- [ ] **Step 6: Commit** — `feat(billing): assinar, cancelar e regularizar pagamento em /plano`.
