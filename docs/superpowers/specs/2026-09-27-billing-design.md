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
| `AsaasClient` | Criar checkout, buscar/procurar assinatura, remover assinatura. Injetável, testes espionam seu método privado de request (mesmo padrão de `MailService`) | env |
| `BillingService` | Planos, plano efetivo do usuário, concessões de fundador | catálogo, `EntitlementsService` |
| `BillingPaymentsService` | Assinar, cancelar, sincronizar, processar eventos do webhook | `AsaasClient`, catálogo |
| `BillingController` | Rotas (seção 9) | `BillingService`, `BillingPaymentsService` |

Regra de ouro: o resto do app só pergunta ao `EntitlementsService`; ele **não** conhece Asaas.

**`AsaasClient`** (Fase 2): `createCheckout`, `getSubscription`, `findSubscriptionByExternalReference`, `deleteSubscription` — nada de `getPayment`/`getCustomer`/`refundPayment`. Decisão do plano de implementação: usar só os dois campos confirmados no spike (`deleted`, `nextDueDate`) pra derivar o estado local (ver `reconcileSubscription` abaixo), em vez de confiar num valor de `status` do Asaas que a Task 12 não chegou a verificar para uma assinatura saudável; `invoiceUrl` vem direto do payload do webhook de pagamento (já confirmado presente), sem precisar de uma chamada `getPayment` separada; `findSubscriptionByExternalReference` (`GET /subscriptions?externalReference=`) resolve o caso de `/billing/sync` recuperar um `CHECKOUT_PAID` perdido, sem depender de um endpoint de consulta de checkout que a Task 12 não confirmou existir. Reembolso continua manual pelo painel do Asaas, o backend só reage ao evento `PAYMENT_REFUNDED`. Retry: 2 tentativas com backoff em erro de rede/timeout/5xx; erro 4xx nunca repete (é erro de dado, repetir não resolve); timeout de 10s por chamada.

**`reconcileSubscription`** (dentro do `BillingPaymentsService`): busca `getSubscription(asaasSubscriptionId)`; `deleted:true` → `CANCELED`; senão, se o `nextDueDate` devolvido é mais recente que o `currentPeriodEnd` já gravado (ou esse campo ainda é nulo) → `ACTIVE` com `currentPeriodEnd = nextDueDate` (cobre tanto a primeira ativação quanto uma renovação); senão → `PAST_DUE` (o vencimento não avançou, então o ciclo atual não foi pago). Usada pelo webhook (`CHECKOUT_PAID`, `PAYMENT_CONFIRMED/RECEIVED/OVERDUE`, `SUBSCRIPTION_DELETED/INACTIVATED`) e por `/billing/sync` — os dois caminhos nunca podem divergir porque chamam a mesma função. `PAYMENT_REFUNDED` é o único evento que não passa por ela: encerra na hora (`currentPeriodEnd = agora`) sem consultar o Asaas de novo, porque o payload do próprio evento já basta.

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
| ACTIVE, PAST_DUE | Assinatura paga via Asaas: `agora ≤ (currentPeriodEnd ?? ∞) + 7 dias` (tolerância de atraso só para ela). Concessão (`GRANT`): `agora ≤ (currentPeriodEnd ?? ∞)`, **sem tolerância** — a data de fim é o fim |
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

O limite vale ao **criar** um item ativo e também ao **reativá-lo** (meta de `PAUSED`/`PLANNED` para `ACTIVE`; reserva ou conta fixa de inativa para ativa); sem isso bastaria pausar e recriar para burlar. Editar um item que já está ativo nunca é bloqueado.

**Exceção aceita:** um saque (`withdraw`) que derruba uma meta `ACHIEVED` de volta pra `ACTIVE` (porque o valor guardado ficou abaixo do alvo de novo) **não** checa o limite — bloquear um saque do próprio dinheiro do usuário por causa de um limite de plano seria pior do que deixar passar. Na prática exigiria a meta já ter chegado ao alvo primeiro, então o excedente é raro e efêmero (o próximo aporte reaplica o alvo).

Estourou: `403` com corpo `{ code: "PLAN_LIMIT", resource, limit, used, plan, message }`. **Nunca apaga nada**: quem cai de plano com itens acima do limite continua editando/concluindo/excluindo; só não cria novos até ficar abaixo.

## 8. Fluxos

**Assinar.** `POST /billing/checkout {plan, interval}` (só planos `sellable`). Antes de criar qualquer coisa, três checagens, nessa ordem:
1. Já existe `Subscription` `ACTIVE`/`PAST_DUE` (Asaas **ou** concessão) de plano igual ou maior → `400`, recusa ("Você já tem uma assinatura ativa; cancele antes de trocar"). Não dá pra ter duas assinaturas Asaas simultâneas pro mesmo usuário.
2. Já existe um checkout `PENDING` (source `ASAAS`) criado há menos de `minutesToExpire` (60 min) → **reaproveita**: devolve o `link` já guardado, sem chamar o Asaas de novo (evita checkout órfão do lado deles).
3. Nenhum dos dois → cria `Subscription` `PENDING` e pede ao Asaas um Checkout `RECURRENT` com valor do catálogo, ciclo `MONTHLY`/`YEARLY`, `billingTypes: ["CREDIT_CARD"]` (confirmado no sandbox: é o **único** método aceito para `RECURRENT`; Pix exige `chargeTypes: ["DETACHED"]` e chave Pix configurada — ver §13), **sem `customerData`** (confirmado no sandbox: mandar só nome/e-mail é rejeitado com `400`; omitir o campo inteiramente funciona e deixa a própria página do Asaas coletar nome/e-mail/CPF/endereço do comprador, o que também bate melhor com "o Lumen nunca vê CPF"), `callback` (`successUrl`/`cancelUrl`/`expiredUrl` em `FRONTEND_URL/plano?...`) e `minutesToExpire: 60`. Guarda `asaasCheckoutId` e devolve o `link`; o app redireciona. O cliente informa nome/e-mail/CPF **na página do Asaas**. A volta para `/plano?checkout=sucesso` **não libera nada**: a tela mostra "Confirmando pagamento…" e consulta `GET /billing/me` por até 60 s.

**Confirmação (o que libera o acesso).** `POST /billing/webhooks/asaas`:
1. Confere o header `asaas-access-token` contra `ASAAS_WEBHOOK_TOKEN` com `timingSafeEqual`; inválido = 401.
2. Sanitiza o payload, grava `BillingEvent` (id único). Evento já processado = 200 sem efeito. Falha ao processar = 500 (o Asaas reenvia; entrega "pelo menos uma vez", 15 tentativas).
3. Mapa de eventos (nomes confirmados no sandbox via API — payload de webhook ao vivo não foi capturado, ver seção 13): `CHECKOUT_PAID` → resolve cliente/assinatura no Asaas por API, grava os ids, `ACTIVE`, `currentPeriodEnd = vencimento + ciclo` · `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` → renova o período (não existe evento de "renovação" próprio; a virada de ciclo aparece como `SUBSCRIPTION_UPDATED` + a cobrança nova) · `PAYMENT_OVERDUE` → `PAST_DUE` + `pastDueSince` · `SUBSCRIPTION_DELETED`/`SUBSCRIPTION_INACTIVATED` → `CANCELED` (do lado do Asaas a assinatura removida vira `deleted:true`+`status:"INACTIVE"`, sem um status "CANCELED" próprio) · `PAYMENT_REFUNDED` → encerra na hora (`currentPeriodEnd = agora`) · evento desconhecido → registra e ignora (responde 200).
4. Os eventos seguintes se casam por `asaasSubscriptionId`/`asaasCustomerId`, **sem depender do `externalReference`**.

**Sincronizar (rede de segurança).** `POST /billing/sync` faz o backend consultar o Asaas e reconciliar o estado do usuário (mesma `reconcileSubscription()` do webhook); cobre webhook perdido. Botão "Já paguei / atualizar" em `/plano`.

**Regularizar pagamento (`PAST_DUE`).** Sem endpoint novo: `/plano` mostra o `invoiceUrl` (seção 13 confirma que toda cobrança tem um) da cobrança em atraso mais recente, já vindo em `GET /billing/me`, como botão "Regularizar pagamento" — o usuário paga essa fatura na página do próprio Asaas. **Não verificado no sandbox:** se pagar a fatura atrasada também atualiza o cartão da assinatura pro próximo ciclo, ou só quita aquela cobrança (ver seção 17). Não bloqueia o lançamento: ao lado sempre existe "Cancelar e assinar de novo" como saída garantida, então o pior caso é o usuário repetir esse passo todo mês até trocar de cartão.

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

- **`/plano` (já existe da Fase 1, ganha ação de verdade):** botões "Assinar" (mensal/anual, cria checkout e redireciona), "Cancelar" (confirma, chama `/billing/cancel`, mostra "acesso até DD/MM"); em `PAST_DUE`, "Regularizar pagamento" (link pro `invoiceUrl`) ao lado de "Cancelar e assinar de novo"; volta do checkout mostra "Confirmando pagamento…" e sonda `GET /billing/me` por até 60s. **Não** suporta trocar mensal↔anual direto (decisão: cancelar e assinar de novo no ciclo desejado).
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

## 13. Achados do spike no sandbox do Asaas (Fase 0)

Spike feito em 2026-09-27 direto na API sandbox (`https://api-sandbox.asaas.com/v3`, header `access_token`). Testado: criar checkout `RECURRENT`, criar cliente/assinatura por API, confirmar pagamento (endpoint sandbox-only), remover assinatura e reembolsar. **Webhook em tempo real não foi capturado** (ver "Limitação" no final); os achados abaixo vêm de respostas reais da API (a Asaas embute o mesmo objeto de recurso no corpo do webhook, então os nomes de campo são os mesmos).

**1. `externalReference` propaga?** Sim, em todos os níveis testados: `checkout.externalReference` (eco exato do que foi enviado), `customer.externalReference`, `subscription.externalReference` e `payment.externalReference` (o pagamento gerado pela assinatura herda o `externalReference` da assinatura). Confirmado com 3 valores diferentes (`spike-1`, `spike-2`, `spike-cc-1`) em cliente, assinatura e cobrança.

**2. Nomes e campos dos eventos:**
- **Checkout:** `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_CANCELED`, `CHECKOUT_EXPIRED`. Corpo: `{ id, event, dateCreated, account, checkout: {...} }`; `checkout` traz `id`, `status`, `billingTypes`, `chargeTypes`, `callback`, `subscription`, `customer` (id, só depois de resolvido), `customerData`.
- **Assinatura:** `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`, `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED` (+ eventos de split, não usados). **Não existe evento de "renovação" separado** — a renovação aparece como `SUBSCRIPTION_UPDATED` (novo `nextDueDate`) e/ou como o `PAYMENT_CREATED`/`PAYMENT_CONFIRMED` da cobrança do novo ciclo. Corpo do objeto `subscription`: `id`, `customer` (id), `externalReference`, `status`, `value`, `nextDueDate`, `cycle`, `billingType`.
- **Cobrança:** `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_DELETED`, `PAYMENT_UPDATED`. Corpo do objeto `payment` traz sempre `id`, `customer` (id), `subscription` (id, quando aplicável), `externalReference`, `status`, `value`, `dueDate`, `invoiceUrl`, `billingType`. Confirmado por API: cartão de crédito aprova direto com `status: "CONFIRMED"` (sandbox aprova qualquer cartão fictício com número válido por Luhn); confirmar via boleto/dinheiro (endpoint sandbox-only) resulta em `status: "RECEIVED"` com `paymentDate`/`confirmedDate` preenchidos.
- Todos os eventos carregam id de cliente e, quando aplicável, id de assinatura — confirmado nos objetos reais (não apenas na doc).

**3. Remoção de assinatura e `invoiceUrl`:** `DELETE /v3/subscriptions/{id}` → `200 { "deleted": true, "id": "..." }`. Uma consulta seguinte (`GET /v3/subscriptions/{id}`) mostra `deleted: true` e **`status: "INACTIVE"`** (não existe um status `"CANCELED"` do lado do Asaas — é `deleted`+`INACTIVE`; o mapeamento para o enum `SubscriptionStatus` do Lumen deve tratar `deleted:true` como `CANCELED`). `invoiceUrl` **está presente em toda cobrança**, cartão ou boleto, formato `https://sandbox.asaas.com/i/{paymentId}` (produção troca o domínio) — pronto para o aviso de atraso.

**Reembolso testado:** `POST /v3/payments/{id}/refund`. **Só funciona para cartão de crédito ou Pix** — boleto dá `400` (`"Somente é possível estornar cobranças cuja a forma de pagamento seja cartão de crédito ou Pix."`). Isso não afeta o Lumen porque o Checkout `RECURRENT` só permite `CREDIT_CARD` (ver abaixo), então todo pagamento assinado é reembolsável. Resposta do refund: `200`, `status: "REFUNDED"`, `refunds: [{ dateCreated, status: "DONE", value, transactionReceiptUrl }]`.

**Desvios encontrados em relação ao desenho original (ajustar Fase 2):**
- **`billingTypes` do Checkout `RECURRENT` só aceita `["CREDIT_CARD"]`.** Enviar `["PIX", "CREDIT_CARD"]` (como o desenho original previa) dá `400`: *"O método de pagamento CREDIT_CARD é o único método de pagamento permitido para operações RECURRENT"* — Pix só existe para `chargeTypes: ["DETACHED"]` (cobrança avulsa) e exige uma chave Pix configurada na conta Asaas (esta conta sandbox não tem). **Ação:** trocar `billingTypes:["PIX","CREDIT_CARD"]` por `billingTypes:["CREDIT_CARD"]` no `AsaasClient.createCheckout` da Fase 2.
- **`customerData` não pode ser parcial.** Mandar só `name`+`email` (como o plano original da Task 12 pedia) dá `400` listando os campos que faltam (`cpfCnpj`, `phoneNumber`, `address`, `addressNumber`, `postalCode`, `province`). Duas opções válidas, testadas: (a) **omitir `customerData` inteiramente** → `200`, e a página hospedada pede nome/e-mail/CPF/endereço do próprio comprador (bate melhor com a premissa "o Lumen nunca vê CPF"); (b) mandar o objeto **completo** (nome, e-mail, CPF, telefone, endereço) se o Lumen já tiver esses dados. **Recomendação:** usar (a) — não mandar `customerData`, só confiar em `externalReference` para casar o checkout com o usuário.

**Confirmado por API/documentação:** header `asaas-access-token`; entrega "pelo menos uma vez" com 15 tentativas e id de evento único; cliente por API aceita `cpfCnpj` fictício válido (usado o exemplo da própria documentação da Asaas); Checkout hospedado devolve `link` (`https://sandbox.asaas.com/checkoutSession/show/{id}`); ciclos `MONTHLY`/`YEARLY`; cartão de teste sandbox: qualquer número fictício válido por Luhn aprova (`5162306219378829` testado e aprovado; `4916561358240741`/`5184019740373151` são os cartões oficiais de **recusa**, documentados pela Asaas).

**Limitação — captura de webhook ao vivo não funcionou:** foi gerado um token aleatório próprio (não o segredo do dono) e registrado `POST /v3/webhooks` apontando para um túnel `localtunnel` público servindo um capturador HTTP local. O túnel respondeu corretamente a chamadas de teste manuais (200, JSON recebido), inclusive depois de reiniciado uma vez após cair. Mesmo assim, ao longo de ~12 minutos e ~10 eventos reais disparados (criar assinatura ×2, criar cobrança ×2, confirmar pagamento, cancelar assinatura, criar+confirmar+reembolsar cobrança de cartão), **nenhum payload real da Asaas chegou** ao capturador — e o contador `penalizedRequestsCount` do webhook não subiu, então não dá pra saber se a Asaas nunca tentou entregar (delay maior que o observado) ou se o túnel engoliu a entrega sem registrar falha. Os achados acima vêm de respostas diretas da API (que trazem o mesmo formato de objeto que o webhook envia), não de um payload de webhook capturado — reflete o que a **Fase 2** vai precisar validar de novo, com um teste que rode por mais tempo ou um túnel mais confiável (ex. `ngrok` com conta).

## 14. Testes

- **Unitários:** catálogo; cada limite; "cair de plano não apaga nada"; bordas da tolerância de 7 dias; concessão sem fim; interruptor desligado = sem limite; virada de mês do Selah no fuso de São Paulo; token e idempotência do webhook; sanitização do payload.
- **Ponta a ponta** com Postgres real e um **Asaas falso** (como o Resend falso já usado): bate no limite → `PLAN_LIMIT` → checkout → webhook simulado → limites liberados → cancelar → fim do período → volta ao grátis; atraso e tolerância; webhook duplicado; token errado; concessão; recusa de checkout com concessão ativa.
- **Navegador real:** `/plano`, avisos de upgrade, landing, admin, claro/escuro, mobile.
- **Sandbox real do Asaas** na Fase 0 (e uma passada final na Fase 2).

## 15. Fases de entrega

0. ✅ **Spike no sandbox do Asaas** — fecha as 3 validações da seção 13 (achados na seção 13).
1. ✅ **Núcleo sem cobrança** — catálogo, tabelas, `EntitlementsService`, limites nos 5 pontos, `GET /billing/me`, `/plano` (uso), concessões pelo admin. Interruptor desligado por padrão. Já entrega valor: o dono concede planos e os limites funcionam quando ligados.
2. **Cobrança** — `AsaasClient`, checkout (com prevenção de duplicado), webhook, sincronizar, cancelar, regularizar pagamento em atraso. **Fora do escopo:** trocar mensal↔anual direto (cancelar e assinar de novo cobre isso); refund self-service (continua manual pelo painel).
3. **Landing de preços, textos legais, avisos de upgrade polidos** — e só então ligar em produção.
4. *(projeto futuro)* Compartilhado.

Cada fase tem seu plano de implementação e é verificada (testes + navegador) antes da seguinte.

## 16. Riscos e pendências do dono

- A conta de **produção** do Asaas exige cadastro e aprovação (pode levar dias): abrir cedo. Definir se recebe como **CPF ou CNPJ/MEI** (decide a nota fiscal) antes de ligar.
- Rascunho dos **Termos de uso e política de reembolso** precisa de revisão do dono (e idealmente de um advogado) antes de ligar.
- Decidir depois se leitura de nota fiscal e importação de CSV entram nos limites (custo de IA da nota).

## 17. Premissas a confirmar

Sem trial do plano pago · teto de uso justo do Selah no Individual em 300/mês · tolerância de atraso de 7 dias · limites do Grátis conforme a seção 4 · **pagar a fatura em atraso pelo `invoiceUrl` atualiza o cartão da assinatura pro próximo ciclo, ou só quita aquela cobrança** (não verificado no sandbox — seção 8, "Regularizar pagamento"; não bloqueia o lançamento porque "cancelar e assinar de novo" sempre funciona como saída).
