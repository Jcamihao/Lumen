# Contrato do item 8c: editar e apagar contas fixas e compras parceladas por conversa

Rascunhado pelo Qwen em 2026-11-23 a partir do código da `develop`. **Status: APROVADO pelo dono em 2026-11-23 ("sim" em D1–D5 — as propostas viraram o texto definitivo).**

## 1. Situação hoje (lido no código em 2026-11-23)

- **Conta fixa** (`RecurringTransactionsService`): tem `update` e `remove` na tela. O `update` aceita descrição, valor, categoria, forma de pagamento, cartão (`cardId`, sob lock), data final e `isActive` — **frequência e dia de vencimento não mudam nunca** (o próprio DTO diz: "apague e crie de novo"). Retomar de pausada consome vaga do plano e pula para o próximo vencimento que ainda vem. `remove` apaga a definição e **os lançamentos já gerados ficam no extrato soltos** (`SetNull`).
- **Parcelado** (`InstallmentsService`): tem `create` e `remove` — **não existe update em lugar nenhum** (nem na tela). `remove` tem a mesma semântica: parcelas já geradas ficam soltas; as que faltavam somem com a definição.
- Schema: os dois têm `cardId` (9a), `isActive`, `updatedAt`; parcela concluída tem `nextDueDate = null`.
- A conversa **já cria** os dois (rascunhos `RECURRING`/`INSTALLMENT`); o matcher tem leitura `minhas parcelas`. O verbo de mudança ainda cai em lançamento sem substantivo (8a) ou meta/reserva (8b).

## 2. Escopo

- **8c-1 (backend)**: intents de editar/apagar com substantivo novo, rascunhos `RECURRING_CHANGE`/`INSTALLMENT_CHANGE` na mesma máquina dos 8a/8b (ação, candidatos, `targetUpdatedAt`, palavra `apagar`/flag, idempotência, RESTORED), busca por termo, gravação **pelos mesmos serviços da tela**.
- **8c-2 (frontend)**: dois `DraftKind` novos no app + rótulos; cartão já funciona guiado por `changeAction` (lição da 8b-2: é quase nada de código).

## 3. Vocabulário e busca

- Substantivo escolhe o alvo, no mesmo lugar do 8b: `conta fixa|contas fixas|fixa(s)` → conta fixa; `parcela(s)|parcelado(s)|compra(s) parcelada(s)` → parcelado. Mesmas travas do 8a/8b (máximo de palavras, sem `?`).
- **"conta" sozinho continua sendo lançamento** (comportamento e testes do 8a intocados) — D1.
- Busca por descrição em memória (sem acento/caixa), todos os status (pausadas inclusas), mais recentes primeiro, teto de 5 — igual 8b.
- Parcelado: lista **só o que ainda tem parcela a gerar** (`isActive` e `nextDueDate` cheio) — apagar compra concluída pela conversa não tem o que parar; pra isso existe a tela. Também não faz sentido editar.

## 4. Apagar

- Prévia com o alvo inteiro + linha de Aviso com a semântica real da tela: conta fixa — "Os lançamentos já gerados continuam no extrato, soltos. Os próximos não vão mais ser gerados."; parcelado — "As parcelas já geradas continuam no extrato, soltas. As que faltavam somem com a compra."
- Só a palavra `apagar` ou a flag do cartão (DTO rígido do 8a-2). Conflito de `updatedAt` nos dois caminhos (lição do 8a: apagar confere também). Gravação por `RecurringTransactionsService.remove` / `InstallmentsService.remove`.

## 5. Editar (pelo chat)

- **Conta fixa**: descrição, valor e data final (`20/12`, `20/12/2026`, ou `sem prazo`) — D2. Uma mudança por mensagem, prévia "antes → depois", confirmação por `RecurringTransactionsService.update` (sem tocar `isActive`/cartão/categoria/forma). Frequência e dia: recusa com a frase da tela ("não mudam depois de criar; apague e crie de novo").
- **Parcelado**: **só apagar**, sem edição — D3.

## 6. Invariantes (herdadas, não negociáveis)

As do 8a/8b: leitura sempre `id + userId`; `updatedAt` contra rascunho velho; idempotência por `messageId`; RESTORED; A/B isolados; nada de entitlement novo (edição sem `isActive` não checa plano; não damos retomar).

## 7. Pausar/retomar

Fora de novo (mesmo item futuro registrado no contrato do 8b) — D5. O serviço já sabe fazer; é decisão de produto, não técnica.

## 8. Fatias e verificação

Fatia backend (spec da máquina + mutantes + integração real em Postgres/Redis descartáveis) e fatia frontend (karma do cartão + rótulos), do mesmo jeito das 8b-1/8b-2. Materialização não roda no caminho do chat (é worker) — só conferir que nada no chat a dispara sem querer.

## 9. Decisões do dono (APROVADAS em 2026-11-23 — "sim" em D1–D5; não perguntar de novo)

- **D1** — `conta` sozinha fica sendo lançamento (só "conta fixa"/"fixa" caem aqui)?
- **D2** — editar conta fixa no chat limitado a descrição, valor e data final?
- **D3** — parcelado no chat só apaga (tela também só apaga)? Editar parcelado de verdade seria apagar+recriar por baixo, com risco de bagunçar as parcelas já geradas.
- **D4** — apagar com a semântica da tela (gerados ficam soltos; próximos somem), sem bloqueio por saldo/vaga?
- **D5** — pausar/retomar continua fora?
