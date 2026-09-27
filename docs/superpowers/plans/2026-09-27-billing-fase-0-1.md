# Billing — Fase 0 e Fase 1 (núcleo sem cobrança) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o núcleo do billing (planos, limites, concessões, tela de uso) funcionando **sem cobrança e desligado por padrão**, e validar no sandbox do Asaas as dúvidas que a Fase 2 precisa.

**Architecture:** Módulo novo `backend/src/billing/` com catálogo de planos (fonte única), regras puras de acesso, `EntitlementsService` (plano efetivo + limites, contando nas tabelas existentes) e `BillingService` (planos, "meu plano", concessões de admin). Os 4 `create()` de itens e o `ask()` do Selah passam a consultar o `EntitlementsService`; o frontend ganha a tela `/plano` e mostra a mensagem de limite. Tudo sob o interruptor `BILLING_ENABLED` (padrão `false` = comportamento de hoje).

**Tech Stack:** NestJS 11 + Prisma 5.22 + Jest (backend); Angular 20 standalone + Signals + Karma/Jasmine (frontend).

**Spec:** `docs/superpowers/specs/2026-09-27-billing-design.md` (Fase 2 = cobrança e Fase 3 = landing/legal ficam para planos próprios).

## Global Constraints

- Limites do **Grátis**: `goals` 2 · `envelopes` 1 · `recurringTransactions` 3 · `installmentPurchases` 2 · `selahQuestionsPerMonth` 5. **Individual**: itens sem limite (`null`), `selahQuestionsPerMonth` 300. **Compartilhado**: igual ao Individual, `seats: 4`, `sellable: false`.
- Preços (R$): Individual 14.90 mensal / 149 anual; Compartilhado 24.90 / 249. Sobrescrevíveis por `BILLING_PRICE_<PLANO>_<MONTHLY|YEARLY>`. Nunca vindos do cliente.
- Acesso de assinatura: `ACTIVE`/`PAST_DUE` enquanto `agora ≤ (currentPeriodEnd ?? ∞) + 7 dias` **apenas para assinaturas pagas via Asaas** (`source: 'ASAAS'`); concessões (`source: 'GRANT'`) **não têm tolerância** — `agora ≤ (currentPeriodEnd ?? ∞)`; `CANCELED` enquanto `agora ≤ currentPeriodEnd`; `PENDING`/`EXPIRED` nunca. Plano efetivo = o maior com acesso (FREE < INDIVIDUAL < SHARED).
- Mês do Selah no fuso **America/Sao_Paulo, UTC-3 fixo** (sem horário de verão). Só conta pergunta **respondida pelo Selah**; fallback local não conta.
- Estouro de limite: `403` com corpo `{ statusCode, error, code: "PLAN_LIMIT", resource, limit, used, plan, message }`, `message` em português. **Nunca apagar dado** ao cair de plano; só bloquear criação.
- `BILLING_ENABLED` padrão `false`: nada é limitado e nada muda para o usuário.
- Nunca limitar: tarefas, lançamentos, categorias, CSV, leitura de nota, exportar dados, MFA, ver/editar o que já existe.
- Convenções do repo: textos em pt-BR; **bump de versão nos 3 `package.json` (raiz, backend, frontend) em todo commit** (patch, `X.Y.Z+1`); mensagem de commit termina com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`; migrations são SQL escrito à mão; sem `git push` sem o dono pedir.
- Comandos: backend `cd backend && npx jest <arquivo>`; tipos `npx tsc --noEmit`; frontend `cd frontend && npx ng test --watch=false --browsers=ChromeHeadless --include='<glob>'`, build `npx ng build`.
- Harness local para verificação: portas **privadas** (Postgres 5434, backend 3051), guardar PID de cada processo em arquivo e matar só por esses PIDs; checar `ss -ltnp` antes de subir (outra sessão usa 5433/3050/6399).

## Review Focus

1. **Meta criada com status não-ACTIVE no limite** (`PLANNED`, `PAUSED` ou `ACHIEVED`) não deve ser bloqueada, mas **reativar** uma meta (`PAUSED`/`PLANNED` → `ACTIVE`) no limite **deve** ser — senão bastaria pausar e recriar para burlar. Testes na Task 6.
2. **Virada de mês do Selah à meia-noite de São Paulo**, não do UTC — teste na Task 3.
3. **Concessão com `endsAt` já no passado** não dá acesso; e concessão + assinatura paga: vence o maior plano — testes nas Tasks 3 e 5.
4. **Admin concede para e-mail com maiúsculas/espaços** e para e-mail inexistente (404); **revogar duas vezes** é idempotente — testes na Task 5.
5. **`BILLING_ENABLED` com valor lixo** (`"talvez"`, vazio) conta como desligado — teste na Task 2.

---

### Task 1: Modelo de dados e migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (novos enums/models; relações em `User`)
- Create: `backend/prisma/migrations/20260927120000_billing_core/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `Subscription`, `BillingEvent`, `SelahUsage` e enums `BillingPlan {INDIVIDUAL SHARED}`, `SubscriptionStatus {PENDING ACTIVE PAST_DUE CANCELED EXPIRED}`, `SubscriptionSource {ASAAS GRANT}`, `BillingInterval {MONTHLY YEARLY}`, exatamente como na seção 6 da spec; `User.subscriptions` e `User.selahUsage`.

- [ ] **Step 1: Adicionar ao `schema.prisma`** os 4 enums, `Subscription`, `BillingEvent`, `SelahUsage` (campos e índices da spec §6) e as relações inversas em `User`.
- [ ] **Step 2: Escrever a migration SQL** à mão (`CREATE TYPE` ×4, `CREATE TABLE` ×3, índices, FKs com `ON DELETE CASCADE` para `User`), no padrão das migrations vizinhas.
- [ ] **Step 3: Verificar que o SQL e o schema coincidem.** Com Postgres do harness (5434) migrado até a anterior: `DATABASE_URL=... npx prisma migrate deploy && npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`. Esperado: `migrate deploy` aplica `billing_core` e o `diff` sai com código 0 ("empty").
- [ ] **Step 4: `npx prisma generate && npx tsc --noEmit`** — esperado: sem erros.
- [ ] **Step 5: Commit** — `feat(billing): modelo de dados (Subscription, BillingEvent, SelahUsage)`.

### Task 2: Interruptor `BILLING_ENABLED`

**Files:**
- Modify: `backend/src/config/app.config.ts` (`billingEnabled`), `.env.example`, `.env.production.example`, `docker-compose.prod.yml` e `docker-compose.yml` (repassar `BILLING_ENABLED: ${BILLING_ENABLED:-false}` ao serviço `backend`)
- Test: `backend/src/config/app.config.spec.ts` (criar)

**Interfaces:**
- Produces: `configService.get<boolean>('app.billingEnabled')`; `true` somente para `1|true|yes|on` (case-insensitive), qualquer outro valor ou ausência = `false`.

- [ ] **Step 1: Teste** `app.config.spec.ts`: `it.each` de `["true","1","YES","on"]` → `true` e `[undefined,"","false","talvez","0"]` → `false`, chamando `appConfig()` com `process.env.BILLING_ENABLED` definido.
- [ ] **Step 2: Rodar** `npx jest src/config` — esperado FAIL (`billingEnabled` inexistente).
- [ ] **Step 3: Implementar** `billingEnabled: parseBoolean(process.env.BILLING_ENABLED, false)` (reusar o `parseBoolean` do arquivo) e documentar a variável nos dois `.env*.example` (comentário: "desligado = sem limites; ligar só quando a cobrança estiver pronta") e nos dois compose.
- [ ] **Step 4: Rodar** `npx jest src/config` — PASS. **Step 5: Commit** — `feat(billing): interruptor BILLING_ENABLED (padrao desligado)`.

### Task 3: Catálogo, exceção de limite e regras puras de acesso

**Files:**
- Create: `backend/src/billing/plans.catalog.ts`, `plan-limit.exception.ts`, `access.util.ts`
- Test: `backend/src/billing/plans.catalog.spec.ts`, `access.util.spec.ts`

**Interfaces (Produces):**
```ts
// plans.catalog.ts
export type PlanId = 'FREE' | 'INDIVIDUAL' | 'SHARED';
export type LimitedResource = 'goals' | 'envelopes' | 'recurringTransactions' | 'installmentPurchases';
export interface PlanDefinition { id: PlanId; label: string; sellable: boolean; seats: number;
  limits: Record<LimitedResource, number | null>; selahQuestionsPerMonth: number | null;
  prices: { MONTHLY: number; YEARLY: number } | null }
export const PLAN_RANK: Record<PlanId, number>;                       // FREE 0 < INDIVIDUAL 1 < SHARED 2
export function getCatalog(env?: NodeJS.ProcessEnv): Record<PlanId, PlanDefinition>;
export function getPlan(id: PlanId, env?: NodeJS.ProcessEnv): PlanDefinition;
// plan-limit.exception.ts
export type LimitedKey = LimitedResource | 'selahQuestions';
export class PlanLimitException extends ForbiddenException {
  constructor(input: { resource: LimitedKey; limit: number; used: number; plan: PlanId });
}
// access.util.ts
export const GRACE_DAYS = 7;
export interface SubscriptionLike { plan: 'INDIVIDUAL' | 'SHARED';
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'; currentPeriodEnd: Date | null;
  source: 'ASAAS' | 'GRANT' }   // tolerância de 7d só para ASAAS; GRANT não tem
export function subscriptionGrantsAccess(sub: SubscriptionLike, now: Date): boolean;
export function pickEffectivePlan(subs: SubscriptionLike[], now: Date): PlanId;
export function currentMonthWindow(now: Date): { start: Date; end: Date };   // [start, end) em America/Sao_Paulo
```

- [ ] **Step 1: Testes** (`plans.catalog.spec.ts`): valores exatos da Global Constraints para os 3 planos; `SHARED.sellable === false`, `FREE.prices === null`; `BILLING_PRICE_INDIVIDUAL_MONTHLY="19.9"` sobrescreve para `19.9`. Mensagem de `PlanLimitException` para `goals` contém `"2 metas ativas"` e o corpo tem `code: 'PLAN_LIMIT'`, `status 403`.
- [ ] **Step 2: Testes** (`access.util.spec.ts`), tabela de casos com `now` fixo: `ACTIVE` dentro do período ✓ · `ACTIVE` em `fim + 7d` ✓ e em `fim + 7d + 1ms` ✗ · `PAST_DUE` idem · `CANCELED` até `fim` ✓ e `fim + 1ms` ✗ · `PENDING`/`EXPIRED` ✗ sempre · `ACTIVE` com `currentPeriodEnd: null` ✓ sempre · concessão com `currentPeriodEnd` no passado (>7d) ✗ · `pickEffectivePlan`: `[]` → `FREE`; `[INDIVIDUAL ativa, SHARED ativa]` → `SHARED`; `[INDIVIDUAL expirada]` → `FREE`. `currentMonthWindow`: `2026-10-01T02:59:59Z` (= 30/09 23:59 em SP) → janela de setembro (`start = 2026-09-01T03:00:00Z`); `2026-10-01T03:00:00Z` → janela de outubro.
- [ ] **Step 3: Rodar** `npx jest src/billing` — FAIL (módulos inexistentes).
- [ ] **Step 4: Implementar** os três arquivos conforme as interfaces. `PlanLimitException`: corpo com os campos da Global Constraints; `message` no formato `Você atingiu o limite de {limit} {rótulo} do plano {Grátis|Individual}. Veja os planos em Plano.`, rótulos: metas ativas / reservas / contas fixas ativas / compras parceladas ativas / perguntas ao Selah neste mês. `currentMonthWindow` desloca `-3h`, trunca no dia 1 e devolve UTC.
- [ ] **Step 5: Rodar** `npx jest src/billing` — PASS. **Step 6: Commit** — `feat(billing): catalogo de planos, excecao de limite e regras de acesso`.

### Task 4: `EntitlementsService` e módulo

**Files:**
- Create: `backend/src/billing/entitlements.service.ts`, `billing.module.ts`
- Modify: `backend/src/app.module.ts` (importar `BillingModule`)
- Test: `backend/src/billing/entitlements.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`app.billingEnabled`), Task 3 (`getPlan`, `pickEffectivePlan`, `currentMonthWindow`, `PlanLimitException`).
- Produces:
```ts
export interface UsageLine { used: number; limit: number | null }
export interface UsageReport { enforced: boolean; plan: PlanId;
  resources: Record<LimitedResource, UsageLine>; selahQuestions: UsageLine & { resetsAt: string } }
export class EntitlementsService {
  constructor(prisma: PrismaService, configService: ConfigService);
  isEnforced(): boolean;
  resolvePlan(userId: string): Promise<PlanId>;
  getUsage(userId: string): Promise<UsageReport>;
  assertCanCreate(userId: string, resource: LimitedResource): Promise<void>;   // throws PlanLimitException
  assertCanAskSelah(userId: string): Promise<void>;                            // throws PlanLimitException
  recordSelahQuestion(userId: string): Promise<void>;
}
```
`BillingModule` exporta `EntitlementsService` e `BillingService`.

- [ ] **Step 1: Testes** (`prisma` mockado, `configService.get` controlando `app.billingEnabled`): (a) desligado: `assertCanCreate`/`assertCanAskSelah` resolvem sem consultar o banco; (b) ligado, FREE com `goals` em 2/2 → rejeita com `PlanLimitException` (`resource:'goals', limit:2, used:2, plan:'FREE'`); com 1/2 → resolve; (c) a contagem de metas filtra `status: 'ACTIVE'` e `userId` (assert no `where` do `count`); (d) INDIVIDUAL ativo com 50 metas → resolve; (e) Selah: usa `selahUsage.count` com `createdAt: { gte: start, lt: end }` da janela do mês e rejeita em 5/5 no FREE, resolve em 299/300 no INDIVIDUAL; (f) `recordSelahQuestion` chama `selahUsage.create({ data: { userId } })`; (g) `getUsage` devolve `enforced:false` com o interruptor desligado, mas com o plano real e as contagens; `resetsAt` = `window.end` em ISO.
- [ ] **Step 2: Rodar** `npx jest src/billing/entitlements` — FAIL.
- [ ] **Step 3: Implementar** `EntitlementsService`: `resolvePlan` lê `subscription.findMany({ where: { ownerUserId } })` e passa a linha **inteira** da assinatura (incluindo `source`) para `pickEffectivePlan` — sem `select` que omita `source`, senão a concessão ganharia a tolerância; contagens: `goal` (`status ACTIVE`), `envelope` (`isActive`), `recurringTransaction` (`isActive`), `installmentPurchase` (`isActive`), `selahUsage` (janela do mês). Limite `null` = ilimitado.
- [ ] **Step 4: Criar `BillingModule`** (providers/exports `EntitlementsService`; `BillingService`/controller entram na Task 5) e registrá-lo em `app.module.ts`.
- [ ] **Step 5: Rodar** `npx jest src/billing && npx tsc --noEmit` — PASS. **Step 6: Commit** — `feat(billing): EntitlementsService (plano efetivo, limites e uso)`.

### Task 5: `BillingService`, controller e concessões do admin

**Files:**
- Create: `backend/src/billing/billing.service.ts`, `billing.controller.ts`, `dto/create-grant.dto.ts`
- Modify: `backend/src/billing/billing.module.ts`
- Test: `backend/src/billing/billing.service.spec.ts`

**Interfaces:**
- Consumes: `EntitlementsService` (Task 4), `getCatalog` (Task 3).
- Produces:
```ts
export interface PublicPlan { id: PlanId; label: string; sellable: boolean; seats: number;
  limits: Record<LimitedResource, number | null>; selahQuestionsPerMonth: number | null;
  prices: { MONTHLY: number; YEARLY: number } | null }
export interface BillingMe { enabled: boolean; plan: PlanId; status: SubscriptionStatus | null;
  source: SubscriptionSource | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; usage: UsageReport }
export interface GrantView { id: string; email: string; name: string; plan: 'INDIVIDUAL' | 'SHARED';
  status: SubscriptionStatus; currentPeriodEnd: string | null; createdAt: string }
// CreateGrantDto: { email: string /*IsEmail*/; plan: 'INDIVIDUAL' /*IsIn*/; endsAt?: string /*IsDateString*/ }
class BillingService {
  getPlans(): { enabled: boolean; plans: PublicPlan[] };
  getMe(userId: string): Promise<BillingMe>;
  listGrants(): Promise<GrantView[]>;
  createGrant(adminUserId: string, dto: CreateGrantDto): Promise<GrantView>;
  revokeGrant(grantId: string): Promise<GrantView>;
}
```
Rotas (`@ApiTags('billing') @Controller('billing')`, padrão do `goals.controller.ts`): `GET plans` (`@Public()`), `GET me`, `GET/POST admin/grants` e `DELETE admin/grants/:id` (`@Roles(UserRole.ADMIN)`; imports em `common/decorators/`).

- [ ] **Step 1: Testes** (`billing.service.spec.ts`, prisma mockado): `getPlans` devolve os 3 planos e `enabled` conforme o config; `getMe` sem assinaturas → `plan:'FREE', status:null, source:null`; com concessão ativa → `plan:'INDIVIDUAL', source:'GRANT'`; **concessão com `currentPeriodEnd` 10 dias no passado → `FREE`**; `createGrant`: e-mail `"  Ana@Exemplo.COM "` normaliza para minúsculas/trim e acha o usuário; e-mail inexistente → `NotFoundException`; já há concessão ativa do mesmo plano → `BadRequestException`; grava `source:'GRANT', status:'ACTIVE', grantedByUserId`, `currentPeriodEnd: null` sem `endsAt`; `revokeGrant`: marca `CANCELED` com `currentPeriodEnd = agora` e **chamar duas vezes não falha** (devolve o registro já cancelado); id que não é `GRANT` → `NotFoundException`.
- [ ] **Step 2: Rodar** — FAIL. **Step 3: Implementar** service, DTO e controller (controller fino: só delega); registrar no módulo.
- [ ] **Step 4: Rodar** `npx jest src/billing && npx tsc --noEmit` — PASS. **Step 5: Commit** — `feat(billing): planos, meu plano e concessoes de admin`.

### Task 6: Aplicar limites nos 4 tipos de item (criar **e reativar**)

**Files:**
- Modify: `backend/src/goals/goals.service.ts` + `goals.module.ts` + `goals.service.spec.ts`; idem `envelopes/`, `recurring-transactions/`, `installments/` (service, module, spec de cada)

**Interfaces:**
- Consumes: `EntitlementsService.assertCanCreate(userId, resource)` (Task 4) — injetado como **último** parâmetro do construtor de cada service; cada `*Module` importa `BillingModule`. Ela também serve para **reativação**: como o item ainda está inativo, `used` não o inclui, então `used >= limit` é exatamente "não cabe mais um ativo".

**Regra (Global Constraints + spec §7):** o limite vale ao **criar** um item ativo e ao **reativar** um item inativo (meta `PAUSED`/`PLANNED` → `ACTIVE`; reserva e conta fixa `isActive: false` → `true`). Editar um item que já está ativo, ou criar/manter um item não-ativo, **nunca** é bloqueado. Compras parceladas não têm reativação (conferir no `installments.service.ts`; se existir caminho que reative, aplicar a mesma regra).

- [ ] **Step 1: Testes** — nos 4 specs existentes, passar o novo argumento (`{ assertCanCreate: jest.fn().mockResolvedValue(undefined) } as any`) e adicionar por serviço: (a) `create` chama `assertCanCreate(userId, '<recurso>')` **antes** de gravar e, se ela rejeita, `prisma.<model>.create` **não** é chamado; recursos: `goals`, `envelopes`, `recurringTransactions`, `installmentPurchases`. (b) **Reativação** (goals, envelopes, recurring): `update` que leva o item de inativo para ativo chama `assertCanCreate` antes de gravar e, se rejeita, `prisma.<model>.update` não é chamado; `update` de um item que **já está ativo** (ex.: só o título) **não** chama `assertCanCreate`. (c) Em `goals`: **criar com `status: 'PAUSED'`, `'PLANNED'` ou `'ACHIEVED'` não chama `assertCanCreate`** (Review Focus 1).
- [ ] **Step 2: Rodar** `npx jest src/goals src/envelopes src/recurring-transactions src/installments` — FAIL nos novos.
- [ ] **Step 3: Implementar**: primeira linha do `create()` de cada service é `await this.entitlements.assertCanCreate(userId, '<recurso>')` (em `GoalsService.create` só quando `(dto.status ?? GoalStatus.ACTIVE) === GoalStatus.ACTIVE`); nos `update()` de goals, envelopes e recurring, depois de carregar o item existente, chamar `assertCanCreate` **somente** quando há transição de não-ativo para ativo.
- [ ] **Step 4: Rodar** os 4 specs + `npx tsc --noEmit` — PASS. **Step 5: Commit** — `feat(billing): limites de itens ao criar e reativar metas, reservas, contas fixas e parceladas`.

### Task 7: Aplicar a cota do Selah

**Files:**
- Modify: `backend/src/assistant/assistant.service.ts`, `assistant.module.ts`, `assistant.service.spec.ts`

**Interfaces:**
- Consumes: `assertCanAskSelah`, `recordSelahQuestion` (Task 4), injetado como **último** parâmetro do construtor (`AssistantService`); `AssistantModule` importa `BillingModule`.

- [ ] **Step 1: Testes** — nos 13 `new AssistantService(...)` do spec, passar um helper `buildEntitlements()` (`assertCanAskSelah`/`recordSelahQuestion` como `jest.fn().mockResolvedValue(undefined)`). Novos: (a) se `assertCanAskSelah` rejeita, `ask()` rejeita com a mesma exceção e **o Selah não é chamado** (`postJson` não invocado); (b) quando o Selah responde (`selahResult.reply`), `recordSelahQuestion(userId)` é chamado **uma vez**; (c) quando cai no *fallback* local, **não é chamado**.
- [ ] **Step 2: Rodar** `npx jest src/assistant` — FAIL nos novos.
- [ ] **Step 3: Implementar** em `ask()`: `await this.entitlements.assertCanAskSelah(userId)` como primeira linha; `await this.entitlements.recordSelahQuestion(userId)` logo depois de confirmar `selahResult.reply`. Não mexer em `saveHistoryTurn`/`getPulse`.
- [ ] **Step 4: Rodar** `npx jest` (suíte completa) `&& npx tsc --noEmit && npx nest build` — PASS. **Step 5: Commit** — `feat(billing): cota mensal de perguntas ao Selah, contada no servidor`.

### Task 8: Verificação ponta a ponta do backend (harness)

**Files:** nenhum arquivo do repo (script descartável no scratchpad).

- [ ] **Step 1:** Subir Postgres 5434 + backend 3051 (`AUTH_MFA_ENABLED=false`, `REDIS_URL` de porta morta) com `BILLING_ENABLED=true`, mais um usuário ADMIN (promover via Prisma: `user.update({ data: { role: 'ADMIN' } })`).
- [ ] **Step 2: Rodar o roteiro** e conferir cada linha: usuário FREE cria 2 metas (201) e a 3ª dá `403 PLAN_LIMIT` com `{resource:'goals', limit:2, used:2}`; `1` reserva ok, 2ª `403`; `GET /billing/me` mostra `plan:'FREE'` e uso 2/2; admin `POST /billing/admin/grants {email, plan:'INDIVIDUAL'}` → 201; o usuário cria a 3ª meta (201) e `GET /billing/me` mostra `plan:'INDIVIDUAL', source:'GRANT'`; `DELETE` da concessão → volta a `403` na criação, **e as 3 metas continuam listadas** (nada apagado); 6ª pergunta ao Selah no FREE (`POST /assistant/ask`, com `SELAH_ASSISTANT_ENABLED=false` **não conta**: 10 perguntas seguidas nunca dão 403) — repetir com um Selah falso respondendo (servidor HTTP local em `SELAH_BASE_URL`) e ver `403` na 6ª; `GET /billing/plans` sem token → 200 com `enabled:true`; usuário comum em `/billing/admin/grants` → 403; reiniciar com `BILLING_ENABLED=false`: 10 metas criadas sem erro.
- [ ] **Step 3:** Encerrar o ambiente **por PID**. Sem commit (registrar o resultado na descrição do commit da Task 9).

### Task 9: Frontend — modelos, serviço e mensagem de limite

**Files:**
- Modify: `frontend/src/app/core/models/domain.models.ts`; `goals-page`, `envelopes-card`, `recurring-transactions-card`, `installment-purchases-card` (os `.ts`) e `assistant-page.component.ts` (handlers de erro de criação/pergunta)
- Create: `frontend/src/app/core/services/billing.service.ts`, `frontend/src/app/core/utils/plan-limit.utils.ts`
- Test: `frontend/src/app/core/utils/plan-limit.utils.spec.ts`, `frontend/src/app/core/services/billing.service.spec.ts`

**Interfaces:**
- Produces:
```ts
// domain.models.ts: PlanId, LimitedResource, PublicPlan, UsageLine, UsageReport, BillingMe, GrantView (mesmos campos do backend, datas como string)
// plan-limit.utils.ts
export function readPlanLimitMessage(error: unknown): string | null;   // só se status 403 e error.error.code === 'PLAN_LIMIT'
// billing.service.ts  (providedIn: 'root', HttpClient + environment.apiBaseUrl)
class BillingService {
  readonly enabled: Signal<boolean>;  readonly me: Signal<BillingMe | null>;
  loadPlans(): Observable<{ enabled: boolean; plans: PublicPlan[] }>;   // atualiza `enabled`
  loadMe(): Observable<BillingMe>;                                       // atualiza `me`
  listGrants(): Observable<GrantView[]>;
  createGrant(body: { email: string; plan: 'INDIVIDUAL'; endsAt?: string }): Observable<GrantView>;
  revokeGrant(id: string): Observable<GrantView>;
}
```

- [ ] **Step 1: Testes**: `readPlanLimitMessage` devolve o `message` para `{status:403,error:{code:'PLAN_LIMIT',message:'X'}}` e `null` para 403 sem código, 400, `null` e string; `BillingService` (`HttpTestingController`): `loadPlans` faz `GET {api}/billing/plans` e seta `enabled()`; `createGrant` faz `POST {api}/billing/admin/grants`.
- [ ] **Step 2: Rodar** (`--include='**/core/**/*.spec.ts'`) — FAIL. **Step 3: Implementar** tipos, util e serviço.
- [ ] **Step 4:** Nos 5 handlers de erro, trocar a mensagem fixa por `readPlanLimitMessage(error) ?? '<mensagem atual>'` (comportamento antigo mantido para os outros erros).
- [ ] **Step 5: Rodar** specs do core + `npx tsc --noEmit -p tsconfig.app.json`; **Step 6: Commit** — `feat(billing): modelos, BillingService e mensagem de limite no frontend`.

### Task 10: Frontend — tela `/plano` e item no menu

**Files:**
- Create: `frontend/src/app/features/billing/plan-page/plan-page.component.{ts,html,scss,spec.ts}`
- Modify: `frontend/src/app/app.routes.ts` (rota lazy `plano`, mesmo padrão das vizinhas), `frontend/src/app/layout/sidebar/sidebar.component.ts` (item `{ label: 'Plano', icon: 'workspace_premium', route: '/plano' }`, exibido só quando `billing.enabled()`; o sidebar chama `billing.loadPlans()` uma vez ao iniciar)

**Interfaces:** Consumes `BillingService.loadMe()/enabled` (Task 9).

- [ ] **Step 1: Teste** (`plan-page.component.spec.ts`, `BillingService` falso): com `enabled=false` mostra "A cobrança ainda não está ativa" e nenhuma barra; com `enabled=true` e `BillingMe` FREE (metas 2/2, Selah 3/5) renderiza o nome do plano, a linha "2 de 2" para metas e "3 de 5" para o Selah; com `plan:'INDIVIDUAL'` e `source:'GRANT'` mostra "Plano Individual — concedido pelo Lumen" e itens "sem limite".
- [ ] **Step 2: Rodar** — FAIL. **Step 3: Implementar** a página com o design system `.proto-*` (cards e barras seguindo o padrão de progresso de Metas/Orçamento), valores `null` = "sem limite". Nenhum botão de assinar nesta fase (entra na Fase 2).
- [ ] **Step 4: Rodar** o spec + `npx ng build` (sem erros nem avisos novos). **Step 5: Verificação visual** com Puppeteer contra o backend do harness (Task 8) ligado: `/plano` FREE e Individual, claro/escuro, desktop/mobile — olhar os prints. **Step 6: Commit** — `feat(billing): tela /plano com uso e limites`.

### Task 11: Frontend — bloco "Conceder plano" no admin

**Files:**
- Modify: `frontend/src/app/features/admin/admin-support-page/admin-support-page.component.{ts,html,scss}`
- Test: `frontend/src/app/features/admin/admin-support-page/admin-support-page.component.spec.ts` (criar ou estender)

**Interfaces:** Consumes `BillingService.listGrants/createGrant/revokeGrant` (Task 9).

- [ ] **Step 1: Teste**: ao iniciar lista as concessões; enviar o formulário (e-mail + data opcional) chama `createGrant` com `{email, plan:'INDIVIDUAL', endsAt?}` e adiciona a linha; botão "Revogar" chama `revokeGrant(id)`; erro de API mostra a mensagem do backend (ex.: "Usuário não encontrado").
- [ ] **Step 2: Rodar** — FAIL. **Step 3: Implementar** o bloco (lista com e-mail, plano, status, fim/"sem fim", revogar) com `saving` para evitar duplo envio (padrão `finalize` já usado nas outras páginas).
- [ ] **Step 4: Rodar** o spec + suíte completa do frontend (`ng test --watch=false`) + `npx ng build`. **Step 5: Commit** — `feat(billing): tela do admin para conceder planos de fundador`.

### Task 12 (independente, depende da chave do dono): Fase 0 — spike no sandbox do Asaas

**Files:**
- Modify: `docs/superpowers/specs/2026-09-27-billing-design.md` (§13, trocando "pendentes" por achados)
- Sem código no repo (script descartável no scratchpad; **a chave nunca entra em arquivo versionado**).

**Pré-requisito:** o dono fornece `ASAAS_SANDBOX_KEY` e o token de webhook. Não bloqueia as Tasks 1–11.

- [ ] **Step 1:** Com a chave em variável de ambiente, criar via API (base sandbox `https://api-sandbox.asaas.com/v3`) um Checkout `RECURRENT` (`billingTypes:["PIX","CREDIT_CARD"]`, `subscription.cycle:"MONTHLY"`, `externalReference:"spike-1"`, `callback` com URLs de exemplo, `customerData` só com nome/e-mail) e registrar a resposta (`id`, `link`).
- [ ] **Step 2:** Pagar o checkout no sandbox pelo navegador (cartão de teste do Asaas) e capturar os webhooks recebidos por um servidor local temporário (túnel ou polling da API de eventos); registrar o payload **exato** de `CHECKOUT_PAID` e dos eventos de assinatura/cobrança (`*_CONFIRMED`, `*_RECEIVED`).
- [ ] **Step 3:** Responder as 3 perguntas da §13: (1) `externalReference` chega à assinatura/cobrança? (2) nomes/campos dos eventos de checkout pago, renovação, vencimento, remoção e reembolso e se trazem ids de cliente/assinatura; (3) como remover a assinatura e se a cobrança traz `invoiceUrl`. Testar também a remoção da assinatura e um reembolso.
- [ ] **Step 4:** Atualizar a §13 da spec com os achados (payloads sem dados pessoais) e ajustar o mapa de eventos da §8 se necessário. **Commit** — `docs(billing): achados do spike no sandbox do Asaas`.
