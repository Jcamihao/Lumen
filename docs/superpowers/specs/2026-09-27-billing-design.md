# Billing do Lumen — desenho

Data: 2026-09-27 · Status: **aguardando revisão do dono** · Roadmap: F6 (antes "planejado e pausado")

## 1. Objetivo

Cobrar pelo Lumen com um modelo **freemium**: plano gratuito com limites e planos pagos que os retiram, com pagamento recorrente via **Asaas**. O plano **Compartilhado** (2 a 4 pessoas) fica **só preparado** na estrutura; o compartilhamento em si é projeto futuro.

Critérios de sucesso:
- Um usuário novo usa o essencial de graça e, ao bater um limite, entende o que o plano pago libera e consegue assinar sem sair do fluxo.
- Pagamento confirmado libera o acesso sozinho; cancelamento, atraso e reembolso se refletem sem intervenção manual.
- O app **nunca vê nem guarda CPF ou dado de cartão**.
- Dá pra fazer o deploy sem mudar o comportamento de hoje (interruptor `BILLING_ENABLED` desligado) e ligar quando o dono quiser.
- Ninguém perde dado ao cair de plano.

## 2. Decisões tomadas (com o dono)

| Tema | Decisão |
|---|---|
| Modelo | Freemium, limites do grátis mais apertados que o padrão |
| Planos | Grátis · Individual · Compartilhado (só estrutura, "em breve") |
| Preços | Individual R$ 14,90/mês ou R$ 149/ano · Compartilhado R$ 24,90/mês ou R$ 249/ano. Configuráveis, sem número fixo no código de regra |
| Limites do Grátis | 2 metas ativas · 1 reserva · 3 contas fixas ativas · 2 compras parceladas ativas · 5 perguntas ao Selah por mês |
| Limitado por quantidade de itens e por perguntas do Selah | Sim. **Não** limitados: tarefas, lançamentos, categorias, importação de CSV, leitura de nota fiscal (por ora) |
| Nunca limitado em nenhum plano | Exportar os próprios dados, MFA/segurança, ver e editar o que já existe |
| Provedor | Asaas |
| Checkout | **Hospedado no Asaas** (Asaas Checkout, `RECURRENT`); o app só redireciona |
| Contas atuais | O dono escolhe quais ganham **Individual sem data de fim** (concessão de "fundador"); as demais entram no Grátis |
| Trial do plano pago | **Não há** (o Grátis já é o teste) — premissa |
| Compartilhado | Só planejamento: enum, `seats` e função única de resolução do plano efetivo |

## 3. Fora do escopo

Compartilhamento de finanças (membros, convite por link de e-mail, dados compartilhados) · tela de faturas · cupons · emissão automática de NFS-e · e-mails de cobrança (o Asaas envia os dele) · limitar leitura de nota fiscal e importação de CSV (decisão de hoje; o desenho permite limitar depois sem mexer no banco).

## 4. Catálogo de planos

Arquivo único `backend/src/billing/plans.catalog.ts`, fonte da verdade para o backend, para `GET /billing/plans` e para a landing.

```ts
FREE:       { goals: 2, envelopes: 1, recurringTransactions: 3, installmentPurchases: 2, selahQuestionsPerMonth: 5 }
INDIVIDUAL: { goals: ∞, envelopes: ∞, recurringTransactions: ∞, installmentPurchases: ∞, selahQuestionsPerMonth: 300 } // teto de uso justo, só p/ proteger custo
SHARED:     { ...INDIVIDUAL, seats: 4 }   // sellable: false
```

Preços (MONTHLY/YEARLY) ficam no catálogo, lidos de constantes sobrescrevíveis por env (`BILLING_PRICE_*`), nunca vindos do cliente. Ordem de plano: FREE < INDIVIDUAL < SHARED.

## 5. Arquitetura

Módulo novo `backend/src/billing/`, peças pequenas com uma responsabilidade cada:

| Peça | Faz | Depende de |
|---|---|---|
| Catálogo | Planos, limites, preços | nada |
| `EntitlementsService` | Resolve o plano efetivo; `assertCanCreate(userId, recurso)`; `assertCanAskSelah(userId)`; `getUsage(userId)` | catálogo, Prisma |
| `PaymentProvider` (interface) + `AsaasClient` | Criar checkout, buscar cliente/assinatura/cobranças, remover assinatura. Testes usam um provedor falso | env |
| `BillingService` | Assinar, cancelar, sincronizar, processar eventos, concessões | as três acima |
| `BillingController` | Rotas (seção 9) | `BillingService` |

Regra de ouro: o resto do app só pergunta ao `EntitlementsService`; ele **não** conhece Asaas.

## 6. Modelo de dados (Prisma)

```prisma
enum BillingPlan          { INDIVIDUAL SHARED }
enum SubscriptionStatus   { PENDING ACTIVE PAST_DUE CANCELED EXPIRED }
enum SubscriptionSource   { ASAAS GRANT }
enum BillingInterval      { MONTHLY YEARLY }

model Subscription {
  id                  String              @id @default(uuid())
  ownerUserId         String
  plan                BillingPlan
  status              SubscriptionStatus  @default(PENDING)
  source              SubscriptionSource
  interval            BillingInterval?
  seats               Int                 @default(1)
  currentPeriodEnd    DateTime?           // null + GRANT = sem fim
  pastDueSince        DateTime?
  cancelAtPeriodEnd   Boolean             @default(false)
  asaasCheckoutId     String?             @unique
  asaasSubscriptionId String?             @unique
  asaasCustomerId     String?
  grantedByUserId     String?
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  owner               User                @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  @@index([ownerUserId, status])
}

model BillingEvent {
  id              String    @id @default(uuid())
  provider        String    @default("ASAAS")
  externalEventId String    @unique     // id do evento do Asaas: idempotência
  type            String
  payload         Json                  // já SANITIZADO (sem CPF nem dado de cartão)
  processedAt     DateTime?
  error           String?
  createdAt       DateTime  @default(now())
  @@index([type, createdAt])
}
```

```prisma
model SelahUsage {              // 1 linha por pergunta respondida PELO SELAH (server-side)
  id        String   @id @default(uuid())
  userId    String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
}
```

- **Por que `SelahUsage` e não `AssistantTurn`:** o `AssistantTurn` é gravado pelo **frontend** (`POST /assistant/history`), então quem perguntasse sem salvar o histórico nunca gastaria a cota. O uso é registrado dentro do próprio `AssistantService.ask()`.
- **Grátis = não ter assinatura com acesso** (sem linha).
- `PENDING` (checkout aberto) **nunca** concede acesso; linhas `PENDING` com mais de 24 h são ignoradas.
- Compartilhado futuro: uma tabela `SubscriptionMember` referenciando `Subscription`; a função de resolução (seção 7) é o único ponto a mudar.
- Sem contadores denormalizados: o uso é contado nas tabelas existentes.

## 7. Plano efetivo e limites

**Acesso de uma assinatura** (calculado na leitura, sem job de expiração):

| Status | Dá acesso enquanto |
|---|---|
| ACTIVE, PAST_DUE | `agora ≤ (currentPeriodEnd ?? ∞) + 7 dias` de tolerância |
| CANCELED | `agora ≤ currentPeriodEnd` (sem tolerância) |
| PENDING, EXPIRED | nunca |

**Plano efetivo** = o maior plano entre as assinaturas do dono com acesso (paga ou concessão); senão FREE. Com `BILLING_ENABLED=false` devolve "sem limites" e nada é aplicado.

**Contagem de uso** (direto no banco):

| Recurso | Conta | Ponto de aplicação |
|---|---|---|
| `goals` | `Goal` com `status = ACTIVE` | `GoalsService.create` |
| `envelopes` | `Envelope` com `isActive` | `EnvelopesService.create` |
| `recurringTransactions` | `RecurringTransaction` com `isActive` | `RecurringTransactionsService.create` |
| `installmentPurchases` | `InstallmentPurchase` com `isActive` | `InstallmentsService.create` |
| `selahQuestions` | `SelahUsage` do mês corrente (fuso America/Sao_Paulo, UTC-3 fixo: o Brasil não tem horário de verão) | `AssistantService.ask`: verifica **antes** de chamar o Selah e registra **depois**, só quando o Selah respondeu. Resposta local de *fallback* **não conta** |

Estourou: `403` com corpo `{ code: "PLAN_LIMIT", resource, limit, used, plan, message }`. **Nunca apaga nada**: quem cai de plano com itens acima do limite continua editando/concluindo/excluindo; só não cria novos até ficar abaixo.

## 8. Fluxos

**Assinar.** `POST /billing/checkout {plan, interval}` (só planos `sellable`; recusa se já há concessão igual ou maior): cria `Subscription` `PENDING` e pede ao Asaas um Checkout `RECURRENT` com valor do catálogo, ciclo `MONTHLY`/`YEARLY`, `customerData` com nome e e-mail pré-preenchidos, `callback` (`successUrl`/`cancelUrl`/`expiredUrl` em `FRONTEND_URL/plano?...`) e `minutesToExpire: 60`. Guarda `asaasCheckoutId` e devolve o `link`; o app redireciona. O cliente informa o CPF **na página do Asaas**. A volta para `/plano?checkout=sucesso` **não libera nada**: a tela mostra "Confirmando pagamento…" e consulta `GET /billing/me` por até 60 s.

**Confirmação (o que libera o acesso).** `POST /billing/webhooks/asaas`:
1. Confere o header `asaas-access-token` contra `ASAAS_WEBHOOK_TOKEN` com `timingSafeEqual`; inválido = 401.
2. Sanitiza o payload, grava `BillingEvent` (id único). Evento já processado = 200 sem efeito. Falha ao processar = 500 (o Asaas reenvia; entrega "pelo menos uma vez", 15 tentativas).
3. Mapa de eventos (nomes a confirmar no sandbox — ver seção 13): checkout pago → resolve cliente/assinatura no Asaas por API, grava os ids, `ACTIVE`, `currentPeriodEnd = vencimento + ciclo` · pagamento confirmado/recebido → renova o período · pagamento vencido → `PAST_DUE` + `pastDueSince` · assinatura removida/inativada → `CANCELED` · reembolso → encerra na hora (`currentPeriodEnd = agora`) · evento desconhecido → registra e ignora (responde 200).
4. Os eventos seguintes se casam por `asaasSubscriptionId`/`asaasCustomerId`, **sem depender do `externalReference`**.

**Sincronizar (rede de segurança).** `POST /billing/sync` faz o backend consultar o Asaas e reconciliar o estado do usuário; cobre webhook perdido. Botão "Já paguei / atualizar" em `/plano`.

**Cancelar.** `POST /billing/cancel`: remove a assinatura no Asaas, marca `cancelAtPeriodEnd`. Acesso segue até `currentPeriodEnd`. Idempotente com o evento de remoção.

**Reembolso (arrependimento de 7 dias, CDC art. 49).** Manual pelo painel do Asaas no início; o evento de reembolso encerra o acesso.

**Concessão de fundador (admin).** `POST /billing/admin/grants {email, plan, endsAt?}` cria `Subscription` `source=GRANT`, `ACTIVE`, sem `currentPeriodEnd` quando sem data de fim. `DELETE /billing/admin/grants/:id` revoga. Apenas `UserRole.ADMIN`.

## 9. API

| Rota | Acesso | Função |
|---|---|---|
| `GET /billing/plans` | público | Catálogo + `enabled` (a landing e o app decidem se mostram preços) |
| `GET /billing/me` | autenticado | Plano efetivo, status, fim/renovação, uso × limites |
| `POST /billing/checkout` | autenticado | Abre checkout (limite 5/hora por usuário) |
| `POST /billing/sync` | autenticado | Reconcilia com o Asaas (limite 10/hora) |
| `POST /billing/cancel` | autenticado | Cancela ao fim do período |
| `POST /billing/webhooks/asaas` | público + token | Recebe eventos (política de rate limit própria e mais alta, por IP) |
| `GET/POST/DELETE /billing/admin/grants` | ADMIN | Lista, concede e revoga plano (revogar encerra na hora e mantém o registro) |

## 10. Frontend

- **`/plano` (nova, no shell):** plano atual e status, barras de uso, botões assinar (mensal/anual) e cancelar, aviso de atraso com ação.
- **Onde se cria** (metas, reservas, contas fixas, parceladas, Selah): mostra "2 de 2" e, no limite, o aviso de upgrade com link para `/plano` (tratamento central do `PLAN_LIMIT`).
- **Landing:** seção de preços, exibida só com `enabled`; a frase "Hoje o Lumen é gratuito… não existe plano pago" é trocada.
- **Admin:** bloco "Conceder plano" na página de admin existente.
- Segue o design system `.proto-*` e os 4 temas existentes; validar claro/escuro e mobile.

## 11. Configuração

| Variável | Uso |
|---|---|
| `BILLING_ENABLED` | Interruptor geral. **Padrão `false`** = comportamento de hoje, sem limites |
| `ASAAS_API_KEY` | Chave da API (sandbox primeiro). Só no `.env.production`, nunca no git |
| `ASAAS_BASE_URL` | Sandbox por padrão; produção só na hora de ligar |
| `ASAAS_WEBHOOK_TOKEN` | Token que o Asaas envia em `asaas-access-token` |
| `BILLING_PRICE_*` | Sobrescreve os preços do catálogo |
| `FRONTEND_URL` | Já existe; base das URLs de retorno do checkout |

O interruptor é lido pelo backend e exposto em `GET /billing/plans`: **ligar/desligar não exige rebuild do frontend**.

## 12. Segurança e privacidade

- Webhook: token em tempo constante; rota pública com limite de taxa dedicado; payload sanitizado (sem CPF nem cartão) antes de gravar; idempotência por id de evento.
- O preço vem do catálogo no servidor, nunca do cliente; `checkout`/`sync` têm limite por usuário.
- Nenhum CPF ou dado de cartão passa pelo Lumen (o cliente digita na página do Asaas).
- LGPD: o Asaas é operador dos dados de pagamento; atualizar Termos de uso e Política de privacidade (rascunho junto na Fase 3); política de cancelamento e reembolso documentada.
- Concessões só por admin, com `grantedByUserId` registrado.

## 13. Validações pendentes no sandbox do Asaas (Fase 0)

O desenho foi feito para **não depender** destes pontos, mas eles definem detalhes de implementação:
1. Se o `externalReference` do checkout chega à assinatura/cobrança.
2. O conteúdo exato do evento de checkout pago (ids de cliente e assinatura presentes ou não) e os nomes dos eventos de assinatura e reembolso.
3. Como remover a assinatura e se a cobrança traz `invoiceUrl` para o aviso de atraso.

Confirmado na documentação: header `asaas-access-token`; entrega "pelo menos uma vez" com 15 tentativas e id de evento único; criar cliente por API exige `name` e `cpfCnpj`; o Checkout hospedado aceita `RECURRENT`, devolve `link`, aceita `customerData` para pré-preencher e `callback` com URLs de retorno; eventos `CHECKOUT_CREATED/PAID/CANCELED/EXPIRED`; ciclos `MONTHLY` e `YEARLY`.

## 14. Testes

- **Unitários:** catálogo; cada limite; "cair de plano não apaga nada"; bordas da tolerância de 7 dias; concessão sem fim; interruptor desligado = sem limite; virada de mês do Selah no fuso de São Paulo; token e idempotência do webhook; sanitização do payload.
- **Ponta a ponta** com Postgres real e um **Asaas falso** (como o Resend falso já usado): bate no limite → `PLAN_LIMIT` → checkout → webhook simulado → limites liberados → cancelar → fim do período → volta ao grátis; atraso e tolerância; webhook duplicado; token errado; concessão; recusa de checkout com concessão ativa.
- **Navegador real:** `/plano`, avisos de upgrade, landing, admin, claro/escuro, mobile.
- **Sandbox real do Asaas** na Fase 0 (e uma passada final na Fase 2).

## 15. Fases de entrega

0. **Spike no sandbox do Asaas** — fecha as 3 validações da seção 13. Precisa da chave de sandbox.
1. **Núcleo sem cobrança** — catálogo, tabelas, `EntitlementsService`, limites nos 5 pontos, `GET /billing/me`, `/plano` (uso), concessões pelo admin. Interruptor desligado por padrão. Já entrega valor: o dono concede planos e os limites funcionam quando ligados.
2. **Cobrança** — `AsaasClient`, checkout, webhook, sincronizar, cancelar, telas de assinar/cancelar.
3. **Landing de preços, textos legais, avisos de upgrade polidos** — e só então ligar em produção.
4. *(projeto futuro)* Compartilhado.

Cada fase tem seu plano de implementação e é verificada (testes + navegador) antes da seguinte.

## 16. Riscos e pendências do dono

- A conta de **produção** do Asaas exige cadastro e aprovação (pode levar dias): abrir cedo. Definir se recebe como **CPF ou CNPJ/MEI** (decide a nota fiscal) antes de ligar.
- Rascunho dos **Termos de uso e política de reembolso** precisa de revisão do dono (e idealmente de um advogado) antes de ligar.
- Decidir depois se leitura de nota fiscal e importação de CSV entram nos limites (custo de IA da nota).

## 17. Premissas a confirmar

Sem trial do plano pago · teto de uso justo do Selah no Individual em 300/mês · tolerância de atraso de 7 dias · limites do Grátis conforme a seção 4.
