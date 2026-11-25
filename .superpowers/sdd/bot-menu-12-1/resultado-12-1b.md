# Resultado 12.1b: adaptador Telegram do menu (botoes, edicao no lugar, teclado fixo)

Data: 2026-11-25. Branch feat/bot-menu-12-1. Conferido por: agente de implementacao (Claude Haiku 5.5). Sem revisor independente nesta fatia (ver NAO verificado).

## O que foi feito

- **Cliente** `telegram-bot.client.ts`: `sendMessage` recebe `TelegramMarkup` (confirm | menu | inline); `editMessageText`; `answerCallbackQuery`; `getUpdates` pede `["message","callback_query"]`. Botao fixo "Menu": `is_persistent`, `resize_keyboard`, sem `one_time`.
- **Parser**: `parseTelegramUpdate` devolve `kind: 'message' | 'callback'`. Callback vira entrada com id do callback, chat, id da mensagem de origem e data. Descarte silencioso: sem `message`, chat nao privado, data nao texto, id invalido.
- **Formatador** `telegram-format.ts`: `formatReplyForTelegram` devolve `markup` (confirm no rascunho; inline no MENU; menu fixo no resto). `menuRows` (uma opcao por linha; submenu com Voltar e Menu na ultima linha; limite de 100 botoes; callback_data de 64 bytes). `nodeIdFromCallback` aceita so `m:<id>` com id de 1 a 40 caracteres. Texto escapado.
- **Adaptador** `telegram-adapter.service.ts`:
  - Clique: rate limit da mesma janela; sem vinculo responde callback vazio e ignora (mudo se Redis caiu); data fora do padrao ignorada; `answerCallbackQuery` best effort; `handleMenuAction` com `userId` do vinculo; DUPLICATE nao reenvia.
  - MENU de clique: edita a mensagem no lugar; se a edicao falha, manda mensagem nova (log so com o nome do erro).
  - Outro kind de clique: mensagem nova com o botao fixo Menu; CONFIRM mantem Confirmar/Cancelar.
  - Texto vinculado: todas as respostas levam o botao fixo, menos Confirmar/Cancelar e a desvinculacao. MENU por texto ("menu", /menu, /start) vai em mensagem nova com o inline.
  - `/menu` e `/start` (so vinculado) viram "menu" no motor; ambos entram em `BOT_COMMANDS`. Sem vinculo, /start segue o fluxo de vinculo.
- **Gate**: a trava `telegram.writesEnabled` fica em `conversation.service.ts` (confirmacao por texto). Clique nao grava por conta propria: a prova esta em `menu-telegram-gate.spec.ts`. Sem mudanca no motor nem no contrato da 12.1a.
- **Fixture** `isolation.fixture.ts`: `buildEngine` ganhou `telegramWritesEnabled` (default false, igual ao comportamento anterior, em que a chave ausente era falsy).

## Comandos e numeros (2026-11-25)

- `npx tsc --noEmit` (backend): exit 0.
- `npx jest src/conversation src/telegram src/whatsapp --maxWorkers=2`: 41 suites, 1822 testes, verde em TZ=UTC, America/Sao_Paulo e Asia/Tokyo.
- Suite inteira `TZ=UTC npx jest --maxWorkers=2`: 99 suites, 3088 testes, verde.
- Testes novos e tocados (`src/telegram`, `menu-telegram-gate`, `menu-action`): 15 seguidas, 118 de 118 verdes em todas.
- `graphify update .` na raiz do worktree: OK (AST, sem LLM). graphify-out e ignorado pelo git.

## Mutantes (mutacao manual no fonte, arquivo restaurado depois de cada um)

Rodados contra `src/telegram`, `menu-telegram-gate` e `menu-action`.

| id | mutante | resultado |
|---|---|---|
| M01 | allowed_updates sem callback_query | morto |
| M02 | botao Menu com one_time_keyboard | morto |
| M03 | editMessageText sem inline_keyboard | morto |
| M04 | parser aceita chat de grupo | morto |
| M05 | parser aceita callback sem data | morto |
| M06 | MENU sem teclado inline | morto |
| M07 | sem limite de 100 botoes | morto |
| M08 | regex do callback sem limite de 40 | morto |
| M09 | sem filtro de callback_data acima de 64 bytes | morto (so pelo teste unitario de menuRows: o regex do fluxo real ja limita o id) |
| M10 | submenu sem botao Menu | morto |
| M11 | escape sem o > | morto |
| M12 | linha vazia na raiz | morto |
| M13 | rascunho sem Confirmar/Cancelar | morto |
| M14 | redis ignorado no clique | morto |
| M15 | dono vira chat id | morto |
| M16 | menu nao edita no lugar | morto |
| M17 | sem fallback de mensagem nova | morto |
| M18 | clique duplicado reenvia | morto |
| M19 | sem Redis responde o callback | morto |
| M20 | formato ruim de callback vira raiz | morto |
| M21 | sem /start | morto |
| M22 | texto vazio sem botao fixo | morto |
| M23 | vinculo sem botao fixo | morto |
| M24 | clique sem answerCallbackQuery | morto |
| M25 | trava de escrita do Telegram desligada no motor | morto |

Resumo: 25 mortos de 25 rodados, 0 sobreviventes, 0 equivalentes. Durante a rodada, o teste de DUPLICATE do clique usava texto vazio e nao pegaria a mutacao; foi trocado por texto real antes de rodar.

## Ajustes de teste de comportamento

- Testes que esperavam `undefined` ou lista de teclado no envio passaram a esperar o markup novo (`{kind: 'menu'}` ou `{kind: 'confirm', labels}`). Mudanca intencional: todo texto ao vinculado agora leva o botao fixo Menu.

## Decisoes tomadas dentro do brief (dono pode vetar)

1. Desvincular ("desvincular telegram") responde sem o botao fixo, porque o chat ja nao e vinculado.
2. Sem Redis, clique de chat sem vinculo fica mudo (como a mensagem). Vinculado segue funcionando.
3. Clique em "Menu" estando ja no menu raiz: a edicao volta "not modified" e o fallback manda mensagem nova com o mesmo menu. Pode deixar duas listas no chat. Aceito pelo brief; se incomodar, tratar "not modified" como sucesso.
4. Texto do menu tem uma parte so (menu curto). `showMenuInPlace` edita so `parts[0]`; teste garante que o texto do menu cabe em uma parte.

## NAO verificado

- Bot API real (botoes, edicao, teclado fixo com `is_persistent`): nao testado. Teste com fetch mockado, sem rede.
- Integracao em Docker com Bot API falsa: fora desta fatia (brief: sem Docker). Nenhum container ou porta foi tocado.
- Revisor independente: nao feito. O fluxo de clique envolve isolamento de identidade (dono so do vinculo). Recomendado revisor antes do merge.
- Lint (`npx eslint`): nao rodado nesta fatia.
- Frontend: nao alterado.
- Limite real de `is_persistent` (Bot API 7+): nao confirmado contra a versao do Telegram em uso.

## Pendencias

1. Revisao independente do adaptador de clique (isolamento e falha de edicao).
2. Teste real com um bot de teste (Bot API), incluindo o fallback de "not modified".
3. Decidir com o dono a decisao 3 (menu duplicado no chat) e a decisao 1 (botao fixo apos desvincular).
4. Fechar a 12.1 com o merge na develop (--no-ff), quando o dono pedir.
