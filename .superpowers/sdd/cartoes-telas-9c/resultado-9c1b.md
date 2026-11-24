# Resultado 9c-1b: cartão nos lançamentos, filtro, ciclo por cartão, rascunhos e menu do Telegram

Data: 2026-11-24. Branch: feat/cartoes-telas-9c (não trocada). Executor: agente Haiku 5.5 (sem revisor sonnet nesta fatia; revisão fica para a etapa sonnet). Conferência independente: pendente do agente principal.

## Mudanças
- `frontend/src/app/core/utils/credit-card.utils.ts`: `activeCards` (sem arquivados, padrão primeiro), `isCreditExpense`, `pickCardId` (valor do seletor: vazio com 1 cartao, offline ou fora de despesa no crédito), `cardIdForPayload`.
- `frontend/src/app/shared/credit-card-select/`: seletor de cartão. Aparece só com despesa no crédito, online e com 2+ cartões ativos; pré-seleciona o padrão; zera o valor quando não vale.
- Lançamento (`finances-page`): seletor (`#transaction-card`), envia `cardId` só em crédito+despesa; filtro "Todos os cartões" (só com 2+), envia `cardId` na lista (busca e mês); chip com `cardName`.
- Compra parcelada e conta fixa: seletor e `cardId` no corpo; lista mostra "Crédito · Nome do cartão".
- `credit-cycle-card`: com 2+ cartões ativos, abas (padrão primeiro, selecionado); ciclo por `GET /credit-cards/:id/cycle`. Com 1 cartão (ou se a lista de cartões falhar): `GET /credit-cycle/current`, como antes. Resposta atrasada de aba antiga é descartada.
- `core/services/life-api.service.ts`: `getCreditCardCycle(id)`; `listTransactions` aceita `cardId`; `createRecurringTransaction` e `createInstallmentPurchase` aceitam `cardId`.
- `core/models/domain.models.ts`: `cardId`/`cardName` em `Transaction`, `RecurringTransaction`, `InstallmentPurchase`.
- `core/models/conversation.models.ts`: `DraftKind` com `CARD_CREATE`/`CARD_RENAME`; `PendingField` com `card` e `closingDay`.
- `assistant-page.component.ts`: rótulos "cartão" e "dia de fechamento" para "Falta informar". Rascunhos de cartão usam a renderização genérica (linhas, confirmar/cancelar).
- `backend/src/telegram/telegram-adapter.service.ts`: comando `cartoes` ("Meus cartões") no menu; `toEngineText` mapeia `/cartoes` para "meus cartoes" e `/cartao` para "cartao". Único arquivo de backend tocado.

## Comandos e números
- `cd backend && npx tsc --noEmit`: OK.
- `cd backend && npx jest src/telegram src/conversation --maxWorkers=2` em TZ=UTC, America/Sao_Paulo e Asia/Tokyo: 28 suítes, 1037 testes, todos passam nos 3 fusos.
- `cd frontend && npx ng build`: OK.
- `cd frontend && npx ng test --watch=false` (suíte inteira, Chrome headless com libs extraídas em pasta do scratchpad): 498 SUCCESS, 0 FAILED no fuso do ambiente; 498 SUCCESS em America/Sao_Paulo e em Asia/Tokyo. Antes da fatia: 459 (revisão 9c-1a).
- `graphify update .`: OK.

## Mutantes (20, um por vez, restaurados depois de cada rodada)
- Frontend (18): M01 arquivados entram; M02 padrão por último; M03 despesa não checada (`isCreditExpense`); M04 seletor com 1 cartão; M05 escolha inválida não volta ao padrão; M06 `cardIdForPayload` ignora crédito; M07 seletor visível offline; M08 reconcile ignora offline; M09 resposta atrasada do ciclo sobrescreve; M10 ciclo com 1 cartão usa `:id/cycle`; M11 sem padrão pré-selecionado no ciclo; M12 busca ignora filtro de cartão; M13 filtro com 1 cartão; M14 parcelado sem cardName na lista; M15 rótulo "cartão" trocado; M17 conta fixa sem cardName; M18 payload do lançamento sem checagem de crédito; M19 payload da compra parcelada sem checagem.
- Backend (2): M16 mapeamento `/cartoes` removido; M20 mapeamento sem normalização (`/Cartao` com maiúscula).
- Primeira rodada: 17 mortos, 3 sobreviventes (M12, M18, M19). Cobertos com testes novos (filtro na busca; payload com controle preenchido fora de crédito). Segunda rodada: 3 mortos.
- Final: 20 mortos, 0 sobreviventes, 0 equivalentes.
- Obs.: M07 e M08 morrem pelos testes de offline (seletor some e cardId não sai offline). M18 e M19 morrem pelo teste que põe cardId no controle com PIX e confere o payload.

## Desvios e decisões de implementação
- Brief pedia "cada aba usa :id/cycle e :id/ceiling". Implementado só `:id/cycle`: o card do ciclo continua só de leitura (edição de teto por cartão não tem tela). Ver duvidas.md, item 4.
- "Edição de item existente carrega o cartão gravado": não se aplica. Lançamento, parcelado e conta fixa não têm tela de edição (conta fixa só pausa/retoma e exclui). Ver duvidas.md, item 5.
- Menu do Telegram: `/cartao` agora também vira "cartao" (antes chegava ao motor com a barra). Comportamento novo para esse comando; ver duvidas.md, item 6.
- Offline: listagem de cartões não roda offline; seletor some; cardId não sai.

## NÃO verificado
- Chrome real contra backend real (seletor, abas e rascunhos ponta a ponta). Sem Docker nesta fatia.
- Visual em 390 px e 1280 px, claro e escuro.
- Teclado e leitor de tela nos novos controles (só label/id e select nativo).
- Offline real no navegador (só sinal `isOnline` mockado).
- Build de produção `build:mobile` e app nativo.
- Suíte repetida 15/30 vezes (intermitência): não feita. Rodadas: 3 fusos, 1 rodada de cada.
- Backend: só telegram e conversation; não rodei a suíte inteira do backend.
- Abas de ciclo com `:id/ceiling`: não implementado (decisão pendente).
- Rascunhos de cartão: não testados contra o motor real; só renderização com draft montado no teste.
- Mapeamento de `/saldo`, `/gastos` e `/ajuda`: não verifiquei se o motor já trata a barra; fora desta fatia.
