# Resultado 9b-3: criar e renomear cartao pela conversa

Data: 2026-11-24. Branch: feat/cartoes-no-bot (sem troca). Implementado por Claude Haiku 5.5 (agente implementador, sessao unica). Revisao sonnet: NAO feita nesta fatia. Conferencia independente do agente principal: pendente.

## Commits
- 3b628da feat(conversa): renomear cartao pela conversa e recusar criar (9b-3)
- 90ab0d2 test(conversa): renomear e criar cartao pela conversa (9b-3)
- este docs (resultado e duvidas 7 a 10)

## Comportamento
- Renomear: "renomear cartao <atual> para <novo>", "renomear <atual> para <novo>", "mudar nome do cartao <atual> para <novo>". O cartao atual e achado pelo nome (busca do 8d, sem acento e caixa). Vira rascunho CARD_RENAME com resumo "Cartao: X / Novo nome: Y" e confirmacao (confirmar/cancelar, expiracao como as demais).
- Confirmar: CreditCardsService.update so do nome (mesmo caminho da API: nome unico entre ativos sob o lock, cartao ativo, 404 para alheio). Recibo: "Cartao X renomeado para Y." e data.cardId.
- Recusas SEM rascunho e SEM gravar: termo vazio; sem "para"; nome novo vazio; nome com mais de 40 caracteres (mesmo limite do DTO); nome novo igual ao atual (exato); nome novo ja usado por outro cartao ativo (sem caixa); cartao inexistente, ambiguo ou arquivado (lista dos ativos); usuario sem cartao ativo ("Voce ainda nao tem cartao ativo.").
- Corrida e falhas na confirmacao: nome tomado entre rascunho e confirmacao -> texto "Ja existe um cartao com este nome. Nada foi alterado." (409 mapeado); arquivado -> texto proprio; removido/alheio -> "Cartao nao encontrado" (404); commit sem confirmacao -> REPLIES.writeUncertain, sem restaurar e sem repetir; falha antes do commit -> rascunho mantido e pode confirmar de novo.
- Telegram: a trava TELEGRAM_WRITES_ENABLED continua no caminho comum de confirmacao (com a trava, so orienta o app).
- Renomeado aparece nas buscas da 9b-1 e 9b-2 (testado: "cartao Roxinho" e "meus cartoes").
- CRIAR cartao: NAO implementado. "criar/novo/adicionar/cadastrar cartao X" responde "Criar cartao pela conversa ainda nao esta disponivel. Crie o cartao na tela de cartoes do app.", sem rascunho e sem gravar. Motivo: CreditCard.closingDay e Int obrigatorio no schema e CreditCardsService.create exige o dia de fechamento; o brief diz "sem fechamento/vencimento por conversa". Decisao do dono: duvida 7.
- Fora do escopo mantido: arquivar, trocar padrao, fechamento/vencimento por conversa. Sem mudanca de schema nem migration. 9b-1 e 9b-2 nao foram alteradas em comportamento.

## Mudancas de codigo
- backend/src/conversation/card-write.ts (novo): parser puro (parseCardRename, o primeiro "para" separa), nameTakenBy, textos (CARD_WRITE_REPLIES, cardRenameDraftText, cardRenamedText).
- backend/src/conversation/parsers/intent.matcher.ts: intents create_card e rename_card (matchCardWrite; "renomear X" nao vira cartao com meta/reserva/conta fixa/parcelado).
- backend/src/conversation/conversation.types.ts: DraftKind 'CARD_RENAME', CardRenameDraft, ReplyData.cardId.
- backend/src/conversation/conversation.service.ts: CreditCardsService injetado (12o argumento); startCardRenameDraft, applyCardRename, createCardUnavailable; ramos em applyByKind, discardText (409/404/arquivado), saveFailedText, isWriteUncertain (CreditCardWriteUncertainError), confirmationText, toDraftView, questionFor, answerPending, numberedOptions.
- backend/src/conversation/conversation.module.ts: importa CreditCardsModule.
- backend/src/conversation/isolation.fixture.ts: realCreditCardsService (CreditCardsService REAL sobre fake de Prisma que honra where; update com spy) e o 12o argumento no buildEngine.
- backend/src/conversation/conversation.service.spec.ts: 12o argumento no construtor.
- Testes novos: card-write.spec.ts (parser e nameTakenBy), parsers/intent.matcher.card-write.spec.ts (matcher e regressao), card-write.service.spec.ts (motor, 37 casos entre renomear e criar).

## Comandos e numeros (2026-11-24)
- cd backend && npx tsc --noEmit: limpo (exit 0).
- npx jest src/conversation src/credit-cards src/transactions src/telegram --maxWorkers=2: 36 suites, 1113 testes verdes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo (antes: 1063; +50).
- npx jest --maxWorkers=2 (suite inteira, TZ=UTC): 90 suites, 2240 testes verdes (antes: 2190; +50).
- Os 50 testes novos repetidos 15 vezes seguidas: 0 falhas.
- graphify update .: ok (6120 nos, 13620 arestas).
- Antes da fatia, o conjunto conversa rodou 873 testes verdes (verificacao intermediaria).

## Mutantes (revisao com mutantes, alvo: card-write, matcher, service, isolamento, conversation.service.spec, credit-cards)
Total 25: mortos 25, sobreviventes 0, equivalentes 0.
- M1 parse sem cleanCardTerm: morto. M2 limite do nome 41 aceito: morto. M3 nameTakenBy inclui o proprio cartao: morto. M4 nameTakenBy sem caixa: morto. M5 separador no ultimo "para": morto.
- M6 renomear sem "para" aceito: morto. M7 "renomear X" sem filtro de meta/reserva: morto. M8 "mudar nome do" sem exigir a palavra cartao: morto.
- M9 sem checagem de mesmo nome: morto. M10 sem checagem de nome ja usado: morto. M11 ambiguo pega o primeiro: morto. M12 sem cartao, lista vazia em vez de "nenhum": morto.
- M13 update com campo extra (countAllPayments): morto. M14 409 sem texto proprio: morto. M15 resultado desconhecido tratado como comprovado: morto. M16 rota de criar vai para renomear: morto. M17 CARD_RENAME roteado para applyCreditLimit: morto.
- M18 falha antes do commit com restore trocado: morto. M19 rotulos do resumo trocados: morto. M20 recibo com nome antigo/novo trocado: morto.
- M21 busca de cartoes sem filtro de arquivado: morto. M22 busca de cartoes sem userId (isolamento): morto. M23 trava do Telegram ignorada: morto.
- M24 CreditCardsService sem checagem de nome (corrida): morto. M25 CreditCardsService aceita cartao arquivado: morto.
Nota de metodo: a primeira rodada classificou um mutante que nao compilava como sobrevivente; foi refeito com variante que compila (M17) e o classificador passou a contar "Test Suites: failed". Os mutantes foram restaurados por escrita do conteudo original (sem git checkout).

## NAO verificado
- Criar cartao pela conversa NAO foi implementado (recusa). Nao verificado: rascunho de criacao, recibo de criacao, teto de 10 cartoes e nome unico na criacao pela conversa. CreditCardsService.create nao e chamado pela conversa.
- Banco real (Postgres e Redis descartaveis) e Docker: NAO feitos (brief: sem Docker nesta fatia). A corrida de nome foi testada com o CreditCardsService real sobre fake de Prisma, nao com lock do banco.
- Resultado desconhecido: simulado com mock do update (CreditCardWriteUncertainError), nao por queda real no commit.
- Ordem da lista de cartoes em ambiguidade: o fake nao aplica orderBy; a asserção ignora a ordem.
- Trava do Telegram LIGADA: nao testada (so desligada). WhatsApp com a escrita renomear: nao testado.
- Frontend: o tipo DraftView.kind do app (frontend/src/app/core/models/conversation.models.ts) nao tem 'CARD_RENAME'. Tela e 9c; nada foi tocado no frontend.
- Lint e formatacao (eslint/prettier): NAO rodados.
- Revisao sonnet e conferencia independente do agente principal: NAO feitas.

## Duvidas abertas
Ver .superpowers/sdd/cartoes-no-bot-9b/duvidas.md, itens 7 a 10 (criar cartao sem dia de fechamento; separador "para"; troca so de caixa; exclusoes do "renomear X").

## Proximos passos
1. Dono decide a duvida 7 (criar cartao): (a) perguntar o dia de fechamento no chat, (c) manter a recusa. Recomendacao: manter (c) ate decidir.
2. Revisao sonnet com banco real (Postgres/Redis descartaveis) e mutantes, e conferencia independente do agente principal.
3. Depois: merge na develop (--no-ff) e atualizar o handoff. Nao feito nesta fatia.
