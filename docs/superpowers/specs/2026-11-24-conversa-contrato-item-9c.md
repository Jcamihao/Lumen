# Contrato do item 9c: telas dos cartões (PROPOSTA, aguarda aprovação do dono)

Data: 2026-11-24. Base: develop com 9a (API de cartões), 9b (bot) e v1.17.0. Fecha o item 9. Só o frontend (Angular) e, em 9c-2, a remoção dos campos antigos do `User`.

## 1. Situação hoje (lido no código)
- `features/card/card-page`: edita só o fechamento do `User.monthClosingDay`. `features/finances/credit-cycle-card`: ciclo/teto do cartão padrão (via `/credit-cycle/*`).
- Lançamento, parcelado e conta fixa (`finances-page`, `installment-purchases-card`, `recurring-transactions-card`) têm `paymentMethod` mas **nenhum** seletor de cartão; a API já aceita `cardId` e devolve `cardName`.
- Cadastro (`register-page`) pede `monthClosingDay`; `core/models/domain.models.ts` e `auth.service.ts` usam o campo do `User`. Há modo offline (`offline-life.service.ts`, fechamento fixo 30).
- `conversation.models.ts` (`DraftView.kind`) não conhece `CARD_CREATE`/`CARD_RENAME` nem o rascunho de escolha de cartão. Menu do bot Telegram (`/cartao`) só lê o padrão.

## 2. Fatias propostas
- **9c-1 (front, sem mudar API):** (a) tela **Cartões**: lista dos ativos (nome, padrão, fechamento, vencimento), criar, editar (nome, fechamento, vencimento), tornar padrão, arquivar, ver arquivados; (b) seletor de cartão no lançamento, parcelado e conta fixa quando for despesa no crédito (padrão pré-selecionado) e `cardName` nas listas; filtro por cartão na lista de lançamentos; (c) cartão de ciclo/teto por cartão (troca de cartão no card do ciclo); (d) tipos de rascunho do assistente (`CARD_CREATE`, `CARD_RENAME`, escolha de cartão) renderizados; (e) menu do Telegram: acrescentar "meus cartões".
- **9c-2 (backend + front):** remover `monthClosingDay`, `creditDueDay`, `creditCycleCountAllPayments` do `User` (migration, espelho da 9a, cadastro passa a criar só o "Principal"). Só depois da 9c-1 estável e com o SELECT de dado fora de 1..31 conferido.

## 3. Regras
- Isolamento: o app só envia `cardId` que veio de `GET /credit-cards`; o servidor continua decidindo (404 igual para alheio/inexistente).
- Padrão não arquiva (API recusa): botão desabilitado com a explicação "torne outro cartão padrão antes".
- Texto novo em português; claro/escuro; 390/1280 px; sem dado de cartão real (só apelido, dia de fechamento e vencimento: o app nunca guarda número de cartão).
- Verificação: `ng test`, `ng build`, Chrome real contra backend real com Postgres/Redis descartáveis, contas A/B, mutantes, revisor sonnet.

## 4. Decisões para o dono (recomendação em negrito)
1. Onde fica a tela de cartões: **transformar a atual `card-page` na lista de cartões** (hoje ela só edita o fechamento) em vez de criar tela nova.
2. Seletor de cartão no lançamento: **só aparece com despesa no crédito e já vem com o padrão marcado** (zero cliques a mais para quem tem um cartão só; com um cartão só, nem mostra o seletor).
3. Card do ciclo no dashboard: **um cartão por vez, com troca por abas/chips; começa no padrão.**
4. Modo offline: **cartões só online na 9c; offline continua com o cartão padrão** (sem criar/editar cartão offline).
5. Remover os campos antigos do `User`: **numa fatia própria (9c-2), depois da 9c-1.**
6. Arquivados: **escondidos por padrão, com interruptor "mostrar arquivados"**, sem desarquivar na 9c.
7. Adicionar "meus cartões" ao menu do bot Telegram: **sim.**
