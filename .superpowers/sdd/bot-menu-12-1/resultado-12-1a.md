# Resultado 12.1a: motor do menu e saida universal

Data: 2026-11-25. Branch feat/bot-menu-12-1. Conferido por: agente de implementacao (Claude Haiku 5.5), sem revisor separado nesta fatia.

## O que foi feito

- **Arvore pura** `backend/src/conversation/menu/menu.tree.ts` (dados) e `menu.tree.queries.ts` (getMenuNode, listChildren, parentOf, validateMenuTree). Tipos em `menu.types.ts`. Areas do contrato secao 2 (Inicio, Financas, Cartao, Metas, Ajuda). Tarefas, Avisos e Conta de fora.
- **Visao e texto** `menu.view.ts`: forma do menu (opcoes, Voltar, Menu) e texto numerado com frase para digitar; linha de dica.
- **Saida universal** `menu/exit-words.ts`: MENU_WORDS e CANCEL_WORDS do contrato secao 4. Frase inteira, sem acento e caixa. "nao", "ok" e "sim" fora.
- **Motor** `conversation.service.ts`:
  - `handleMenuAction({userId, channel, messageId, nodeId, receivedAt})`: raiz e nos de grupo viram MENU; folha de frase executa handleMessage com a frase e acrescenta a dica; folha de instrucao responde HELP com a instrucao e a dica; id desconhecido cai na raiz; messageId repetido vira DUPLICATE.
  - Saida: com rascunho, cancela (texto de sempre, kind CANCELLED) e anexa o menu; sem rascunho, MENU_WORDS mostram o menu e CANCEL_WORDS respondem "Nada para cancelar." + menu. CANCEL_WORDS antigo (cancelar, parar, voltar) substituido pela lista nova.
- **Tipos**: `ConversationReplyKind` ganhou MENU; `ConversationReply` ganhou `menu?: MenuView`. Frontend: MENU na uniao `ConversationReplyKind` (so o tipo).
- **Ajuda**: REPLIES.help lista exemplos por area e diz que da para falar direto ou usar "menu".
- **Sem migration, sem coluna nova, sem Telegram/WhatsApp alterados**. WhatsApp e Telegram imprimem o text do MENU; o desenho de botoes e a 12.1b.

## Escolhas de frase por folha de escrita

Verificado com o motor (teste "folha de escrita por frase abre o rascunho guiado"): "gastei" e "recebi" pedem o valor (ASK_FIELD). As demais escritas viraram instrucao (ver duvidas.md, item 2).

## Comandos e numeros (data 2026-11-25)

- `npx tsc --noEmit` (backend): exit 0.
- `npx jest src/conversation src/telegram src/whatsapp --maxWorkers=2` com TZ=UTC, America/Sao_Paulo e Asia/Tokyo: 40 suites, 1784 testes, verde nos tres fusos.
- Suite inteira (`npx jest --maxWorkers=2`, TZ=UTC), depois do ultimo teste: 98 suites, 3050 testes, verde.
- Testes novos (`src/conversation/menu`, 67 testes) 15 seguidas: 15 de 15 verdes.
- `graphify update .` na raiz do worktree: OK (AST, sem LLM).

Novos testes: `menu/menu.tree.spec.ts` (invariantes, toda frase e todo exemplo de folha casam com matchIntent, validador com mutantes de arvore), `menu/exit-words.spec.ts`, `menu-action.spec.ts` (navegacao, folhas, idempotencia, isolamento A/B, saida com e sem rascunho, ajuda). Helper `expectNoLeakFor` em `isolation.fixture.ts`.

## Mutantes (mutacao manual, arquivo restaurado depois de cada um)

Rodados contra: menu, menu-action, conversation.service, isolation, intent.matcher.spec.

| id | mutante | resultado |
|---|---|---|
| M01 | "chega" fora de CANCEL_WORDS | morto |
| M02 | "start" fora de MENU_WORDS | morto |
| M03 | "nao" vira palavra de saida | morto |
| M04 | normalizacao so caixa (sem tirar acento) | morto |
| M05 | duplicata sem userId no filtro | morto |
| M06 | duplicata ignorada em handleMenuAction | morto (sobrevivia; teste de duplicata para navegacao e instrucao adicionado, depois morto) |
| M07 | no desconhecido quebra (! sem fallback) | morto |
| M08 | cancelar com rascunho sem menu anexado | morto |
| M09 | "Nada para cancelar." sem aviso | morto |
| M10 | folha de frase sem dica | morto |
| M11 | withDica no-op | morto |
| M12 | navegacao grava sempre menu_open | morto |
| M13 | instrucao sem dica | morto |
| M14 | folha de frase executa frase errada | morto |
| M15 | area sem Voltar/Menu | morto |
| M16 | validador aceita grupo com acao | morto |
| M17 | validador aceita ciclo (sem guarda) | morto |
| M18 | validador aceita id repetido | morto |
| M19 | parentOf devolve o proprio id | morto |
| M20 | saida com rascunho nao cancela | morto |
| M21 | saida com rascunho fora do fluxo | morto |
| M22 | saida sem rascunho fora do fluxo | morto |
| M23 | ajuda sem a dica de menu | morto |
| M24 | validador sem checagem de bytes de 64 | equivalente: o regex limita o id a 40 caracteres ASCII, entao a checagem de bytes nunca dispara. Nao rodado. |

Resumo: 23 mortos de 23 rodados (M06 na segunda rodada), 1 equivalente (M24, nao rodado), 0 sobreviventes.

## NAO verificado

- Telegram real (botoes, mensagem editada, teclado fixo): fora desta fatia (12.1b).
- WhatsApp real: nao alterado; so a suite automatica dele.
- Frontend: so a uniao de tipos mudou. Build e testes do Angular nao rodados.
- Lint: `npx eslint` nao rodou (ESLint 8 nao achou o padrao de arquivos com a config atual). Nao verificado.
- Integracao real em Docker e Bot API falsa: nao aplicavel nesta fatia (brief: sem Docker). Nenhum container ou porta foi tocado.
- Clique real chegando por HTTP: o motor e chamado direto pelos testes; nao ha endpoint novo nem controller de menu nesta fatia.
- Revisao independente por subagente: nao feita; o agente principal conferiu os numeros acima.

## Pendencias

1. 12.1b: adaptador Telegram (callback_data = id do no, mensagem editada, teclado fixo "Menu", comandos /menu e /start).
2. Revisar com o dono as decisoes da duvidas.md (itens 2 a 5).
