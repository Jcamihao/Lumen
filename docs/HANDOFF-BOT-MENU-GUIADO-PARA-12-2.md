# Handoff para o agente da 12.2 — o que mudou no bot (menu guiado, v1.26.0)

Atualizado em 2026-11-26. Quem escreveu: agente do menu guiado (Claude Sonnet 5.5). Leia antes de mergear a develop na `feat/bot-tarefas-12-2`: vários arquivos que você mexe também foram mexidos aqui.

## Estado do git

- `develop` = `875ac66`; `master` = `fef840e` (merge da v1.26.0); tags `v1.25.0`, `v1.25.1`, `v1.26.0` no remoto.
- A ajuda do bot (`f6ce5bc`, merge `076689d`, handoff `875ac66`) está só local na develop, ainda sem push.
- Não toquei na pasta principal `Lumen` nem na sua branch. Quando vi, havia merge da develop em andamento com conflitos; não mexi. Se for retomar, o merge deve ser da develop `875ac66`, não da `340c498`.
- Branch `feat/8d1-backend-limite-cartao` (`e4c89ab`) segue local, não enviada.

## O que entrou na develop (ordem lógica)

1. **Saudações abrem o menu** — "oi", "bom dia", "ola", "oiieee", "opa" etc. (`menu/exit-words.ts`, `isGreeting`, usado em `handleWithoutSession`).
2. **Menu com guia, saudação por horário e emojis** — `menu/greeting.ts` (`greetingFor(now, tz)`: bom dia 5h–11h59, boa tarde 12h–17h59, boa noite nas demais; fallback São Paulo). `MenuNode` ganhou `guide`, `intro` e `example`. Título raiz "✨ Lumen · o que vamos fazer hoje?".
3. **"Gastei 3$ tomando café na padaria"** — `parsers/amount.parser.ts` (`dropTrailingCurrencySign`, `/(\d)\s?\$(?!\d)/g`) e `intent.matcher.ts` aceitam cifrão depois do número.
4. **Menu guiado em 5 fatias** (cada folha de ação agora é frase que o matcher reconhece):
   - Lançamentos: editar/apagar começam por lista compacta dos últimos 15, com "mais" (paginação por posição, `TX_LIST_PAGE_SIZE`).
   - Categorias: grupo `financas.categorias` com listar, criar, editar e excluir.
   - Metas: guardar, editar e apagar começam por lista das metas (máx. 10, avisa quando passa).
   - Cartões: limpar limite, definir limite, renomear e criar cartão, com lista quando há vários.
   - Conferência final (receita, meta, limite).
5. **Plano Família** virou o item 13 (só contrato; sem código).
6. **Ajuda reescrita** — `REPLIES.help` com seções e emojis.

## Arquivos e símbolos que provavelmente conflitam com a 12.2

- `backend/src/conversation/conversation.service.ts` (~5000 linhas). Novos: `startCategoryCreateDraft`, `answerCategoryCreate`, `applyCategoryCreate`, `startCategoryChangeDraft`, `answerCategoryChange`, `applyCategoryChange`, `categoriesReply`, `ownCategories`, `categoryPickText`, `guardCategoryWrite`, `resolveCategory`, `startCardPick`, `answerCardPick`, `cardPickText`, `prepareClearLimitDraft`, `prepareSetLimitDraft`, `startCardCreateDraft`, `answerCardCreate`, `startTargetChange`, `targetListText`, `recentTransactionsPage`, `nextTransactionsPage`, `transactionListText`, `isAwaitingFirstAmount`, `replaceDraft`, `isCategoryCreateAnswer`, `activeCards`. Construtor: `FinanceCategoriesService` injetado no fim; `FinanceCategoriesModule` importado em `conversation.module.ts`.
- `conversation.types.ts`: `DraftKind` ganhou `CATEGORY_CREATE`, `CATEGORY_CHANGE`, `CARD_PICK`. Se a 12.2 adiciona `DraftKind` de tarefa, o `tsc` aponta cada ponto de fiação (`answerPending`, `applyByKind`, `questionFor`, `toDraftView`, `draftText`). `CardCreateDraft.name` agora é `string | null`. `TransactionChangeDraft` ganhou `listOffset` e `hasMore`; `TargetChangeDraft` ganhou `hasMore`. `ConversationInput.viaMenu?: true` marca texto vindo de botão do menu (nunca vale como resposta de nome). `ReplyData.categoryId`.
- `parsers/intent.matcher.ts`: `ReadIntent` ganhou `'categories'`; intenções `create_category`, `edit_category`, `delete_category`; noun `categoria` em `matchTransactionChange`; `renomear cartao` sozinho. Se a 12.2 mexe em `ReadIntent`, mantenha `'categories'`.
- `menu/menu.tree.ts`, `menu.view.ts`, `menu.types.ts`: árvore reescrita. O teste `menu.tree.spec.ts` exige que **toda frase de folha case com o matcher**. Se você acrescentar nó de Tarefas, use `action: { type: 'phrase', ... }` com frase que o matcher reconhece, e `guide`/`intro`/`example` no mesmo estilo.
- `replies.ts`: `REPLIES.help` novo. Teste `teaching-texts.spec.ts`: todo texto entre aspas na ajuda precisa casar no matcher (exceto "menu"); não use aspas em palavra de controle como cancelar. Se a 12.2 puser exemplo de tarefa na ajuda, a frase tem de casar.
- Outros: `card-write.ts`, `target-change.ts`, `transaction-change.ts`, `credit-limit.ts` (`ChatCard.isDefault?`), `category-write.ts` (novo), `menu/greeting.ts` (novo).

## Convenções que o novo código segue (mantenha)

- Resultado de gravação em três estados: persistiu, não persistiu comprovadamente, desconhecido. `CategoryWriteUncertainError` + `guardCategoryWrite`: 4xx = recusa provada; o resto = desconhecido, sem repetir.
- `PendingAnswer`: `UPDATED`, `ASK` (com `prefix`) e `ERROR` (mantém a sessão).
- `replaceDraft` troca o conteúdo do draft no lugar e muda o tipo.

## Armadilhas de teste

- NBSP no `R$`: use `replace(/\s/g, ' ')` nas asserções.
- `instanceof Date` quebra sob `jest.useFakeTimers`; use `getTime?.()`.
- Fakes de Prisma precisam de `skip`, `take` e operador `not`.
- `edit` com várias ocorrências falha; use contexto único.
- Rodar leve: `nice -n 19`, `--maxWorkers=1`, sem Docker pesado.

## Números verdes (2026-11-26, conferido pelo agente principal)

- `tsc` limpo; `conversation`, `telegram`, `whatsapp`: 2210 testes verdes em UTC, America/Sao_Paulo e Asia/Tokyo (antes da ajuda; com a ajuda, 2210 em UTC).
- Revisão sonnet por fatia: fatia 2 teve 1 grave (falha de gravação alegava "nada gravado") e 7 riscos, todos corrigidos; fatias 1, 3, 4, 5: 0 graves, 5 riscos corrigidos ou aceitos e documentados.
- Mutantes: sobreviventes viraram testes (id de outro usuário na escolha de categoria, atalho de um cartão só no "limpar limite", número acima de 5 na escolha de cartão).

## NÃO verificado

- Telegram e WhatsApp reais (títulos de várias linhas, emojis nos botões, a nova ajuda).
- Postgres real: só banco falso nos testes. O filtro `receiptScan: null` e o `FinanceCategoriesService` só foram testados assim.
- Lint e integração em contêiner descartável.
- Paginação de lançamentos sob concorrência (é por posição; um lançamento novo no meio da leitura pode deslocar a página — aceito e documentado).

## Onde estão os detalhes

- `docs/superpowers/specs/2026-11-26-bot-menu-guiado-contrato.md`
- `.superpowers/sdd/bot-menu-guiado/resultado.md`
- `docs/releases/v1.26.0.md`
- `docs/superpowers/specs/2026-11-25-item-12-bot-v2-fases.md` (linha 12.1c)
- `docs/HANDOFF.md` (parágrafos do menu guiado e da ajuda)
- Plano Família (item 13): `docs/superpowers/specs/2026-11-26-conversa-contrato-item-13.md`
