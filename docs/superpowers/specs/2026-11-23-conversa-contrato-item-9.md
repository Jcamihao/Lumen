# Contrato do item 9: vários cartões nomeados (entrega 9a, só backend)

Status: **aprovado pelo dono em 2026-11-23** ("sim em todas" nas 5 decisões da seção 8; não pedir aprovação de novo). Branch `feat/varios-cartoes` (base `develop` `92fff11`).
Validado pelo dono em 2026-11-23: modelo `CreditCard` por usuário; limite por plano **fica para depois do billing**; primeira entrega **só backend**, front depois integrando tudo.

## 1. Situação hoje (lido no código)
- Um cartão só, espalhado no `User`: `monthClosingDay` (fechamento), `creditDueDay`, `creditCycleCountAllPayments`.
- `CreditCycleCeiling` (userId, closingDate) guarda o teto do ciclo; `CreditCycleService` calcula gasto = EXPENSE com `paymentMethod=CREDIT` no ciclo (ou toda EXPENSE se `countAllPayments`).
- `Transaction`, `InstallmentPurchase` e `RecurringTransaction` têm `paymentMethod` (PIX, CREDIT, DEBIT), sem noção de qual cartão.
- Usam o ciclo: `credit-cycle` (API `/credit-cycle/*`), `insights.service`, `conversation.service` (limite do cartão por conversa), `users`, `auth`.

## 2. Modelo
`CreditCard`: `id`, `userId` (FK, cascade), `name` (1 a 40 caracteres, aparado), `closingDay` (1 a 31), `dueDay` (1 a 31, opcional), `countAllPayments` (bool, padrão false), `isDefault` (bool), `archivedAt` (opcional), `createdAt`, `updatedAt`.
- Nome único por usuário, sem diferenciar maiúscula, entre cartões não arquivados (índice único parcial em SQL na migration).
- Exatamente um cartão padrão ativo por usuário (índice único parcial em `userId` onde `isDefault` e não arquivado).
- `CreditCycleCeiling` ganha `cardId`; unicidade passa a `(cardId, closingDate)`.
- `Transaction`, `InstallmentPurchase` e `RecurringTransaction` ganham `cardId` opcional (FK, SetNull), só aceito com `paymentMethod=CREDIT`. Parcelas e recorrências geradas herdam o `cardId`.

## 3. Migration (dados existentes)
Para cada usuário: criar o cartão **"Principal"** (padrão) com `closingDay=monthClosingDay`, `dueDay=creditDueDay`, `countAllPayments` igual ao atual; preencher `cardId` dos tetos existentes; lançamentos CREDIT antigos ficam com `cardId` nulo e contam no cartão padrão (regra do item 4.3), então o histórico não muda. Criação de usuário novo (cadastro) também cria o "Principal". Testar em Postgres 16 descartável, banco limpo e banco populado com o schema anterior.

## 4. Regras
1. **Isolamento:** todo acesso a cartão filtra por `userId` do token. Cartão de outro usuário responde 404 (nunca 403), em qualquer rota e em qualquer `cardId` recebido em lançamento, parcelado ou recorrência.
2. **Compatibilidade:** `/credit-cycle/current`, `/credit-cycle/settings`, `/credit-cycle/ceiling` e o fluxo de limite por conversa passam a operar **no cartão padrão**, com a mesma resposta de hoje. Durante a 9a, `monthClosingDay`, `creditDueDay` e `creditCycleCountAllPayments` do `User` são mantidos em sincronia com o cartão padrão na mesma transação; a remoção deles fica para depois do front.
3. **Gasto do ciclo de um cartão** = soma das EXPENSE `CREDIT` do ciclo com `cardId` igual ao do cartão; o cartão padrão soma também as de `cardId` nulo.
4. **`countAllPayments`** (teto geral de gastos) só pode ser ligado no cartão padrão; nele soma toda EXPENSE do ciclo, de qualquer cartão e de PIX/débito. Nos demais cartões é sempre false.
5. **Arquivar, não apagar:** `DELETE /credit-cards/:id` arquiva (`archivedAt`). Lançamentos antigos mantêm o `cardId`. Cartão arquivado não aceita novo lançamento, mas aparece no histórico. Não se arquiva o cartão padrão: antes é preciso promover outro (`POST /credit-cards/:id/make-default`).
6. **Teto técnico** de 10 cartões ativos por usuário, contra abuso. **Não é limite de plano**; o limite por plano vem depois do billing e será consultado só ao `EntitlementsService`.
7. **Gravação:** escritas devolvem recibo do que foi persistido (id, nome, dias, padrão). Serialização por bloqueio da linha do `User` com `FOR NO KEY UPDATE`. Três resultados: persistiu, não persistiu comprovadamente, desconhecido (neste caso não repetir). Falha auxiliar depois do commit (`touchUserData`) não desfaz nem repete (`refreshPending`), como em `setCeilingForConversation`.
8. Insights de ciclo (`detectCreditCycle`) passam a olhar o cartão padrão na 9a (comportamento igual ao de hoje); alerta por cartão fica para a 9b ou depois.

## 5. API da 9a
- `GET /credit-cards` (ativos; `?includeArchived=true`), `POST /credit-cards`, `GET /credit-cards/:id`, `PATCH /credit-cards/:id` (nome, fechamento, vencimento, countAllPayments), `DELETE /credit-cards/:id` (arquivar), `POST /credit-cards/:id/make-default`.
- `GET /credit-cards/:id/cycle` (mesma forma de `/credit-cycle/current`), `PUT /credit-cards/:id/ceiling`.
- Lançamento, parcelado e recorrência aceitam `cardId` opcional; leitura devolve `cardId` e `cardName`.
- Swagger atualizado. Frontend **não** é tocado na 9a.

## 6. Fora da 9a (fica para depois, com contrato próprio quando chegar a hora)
- 9b: o bot saber o cartão ("gastei 50 no Nubank", "limite do Nubank"), listar cartões, escolha quando houver mais de um.
- 9c: telas (Configurações, lançamento, dashboard) e remoção dos campos antigos do `User`.
- Limite de cartões por plano (depois do billing). Fatura por cartão com data de pagamento e lembrete.

## 7. Plano de execução e verificação
Fatias: 9a-1 schema + migration + serviço de cartões + compatibilidade `/credit-cycle`; 9a-2 `cardId` em lançamento, parcelado e recorrência. Implementação com haiku, revisão com sonnet (item de isolamento exige revisor), conferência independente do agente principal.
Verificação exigida: isolamento A/B/C em todas as rotas; mutantes (mortos, sobreviventes, equivalentes); migration em Postgres 16 descartável (limpo e populado), em portas livres conferidas com `ss -ltn`, tudo removido no fim; concorrência (criar, promover padrão e editar em paralelo); falha controlada dentro de transação real; suíte em `TZ=UTC`, `America/Sao_Paulo` e `Asia/Tokyo`; testes intermitentes 15 vezes. Seção "NÃO verificado" no relatório.

## 8. Decisões para o dono (recomendação em negrito)
1. Arquivar em vez de apagar cartão com histórico: **sim**.
2. `countAllPayments` só no cartão padrão: **sim** (evita somar o mesmo gasto em dois tetos).
3. Lançamento CREDIT sem cartão informado conta no padrão: **sim**.
4. Teto técnico de 10 cartões: **sim**, trocado pelo limite do plano depois do billing.
5. Manter os campos do `User` em sincronia até o front migrar: **sim**.
