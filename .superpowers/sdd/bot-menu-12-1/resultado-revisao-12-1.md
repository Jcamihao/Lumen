# Resultado da revisao 12.1 (12.1a + 12.1b)

Data: 2026-11-25. Branch feat/bot-menu-12-1. Revisor: Claude Sonnet 5.5 (sessao unica, com integracao real).

## Veredito: GO (condicionado a 3 duvidas de produto abaixo; nenhuma e bloqueio de seguranca)

Isolamento da identidade do clique: sem falha achada. Dono vem so do vinculo chat->usuario; o callback_data so escolhe no da arvore publica.

## Achados

1. **Corrigido (decisao 3 da 12.1b).** Clique em "Menu" no menu inicial: Telegram responde HTTP 400 "message is not modified" e o adaptador mandava segunda lista. Correcao: `TelegramBotError.notModified` (so a marca sai da descricao; texto nunca entra na mensagem nem no log); adaptador trata como sucesso silencioso (so answerCallbackQuery). Outros erros de edicao seguem caindo em mensagem nova. Commit 9362937. Reproducao real: Bot API falsa devolvendo 400 "message is not modified" -> 0 sendMessage; devolvendo "message to edit not found" -> 1 sendMessage.
2. **Corrigido (teste).** Mutantes sobreviventes: regex do callback sem `^` (aceitaria "xm:financas") e clique sem checar sessao expirada. Testes novos, ambos mortos.
3. **Duvida de produto (nao decidi).** Botao fixo "Menu" tocado com rascunho aberto cancela o rascunho (saida universal do contrato). Clique em botao inline de navegacao NAO cancela (verificado). Risco: toque acidental perde o rascunho.
4. **Duvida de produto.** Texto do menu inclui a lista numerada e a frase "Digite a frase entre aspas..." mesmo no Telegram, onde ha botoes (texto duplicado com os botoes).
5. **Observacao.** Clique acima de 20/min por chat (limite compartilhado com mensagens) e descartado sem answerCallbackQuery: o botao fica com o relogio ate o Telegram expirar. Nao grava nada, so UX.
6. **Observacao.** O laco de long polling e unico consumidor: nao ha cliques concorrentes do mesmo chat dentro de uma instancia. Duas instancias dependem do unique (userId, channel, messageId); o contrato ja exige instancia unica.

## Integracao real (2026-11-25)

Conteineres rv12-pg (postgres:16-alpine) e rv12-redis (redis:7-alpine), portas aleatorias em 127.0.0.1 (a publicacao de porta fixa falhou no Docker Desktop: erro 500 de forwards/expose). 35 migrations aplicadas. Backend build subido com ENV inline, Bot API falsa em node http (127.0.0.1:53121), contas A, B, C vinculadas pelo fluxo real (link-code + codigo no chat).

| cenario | resultado |
|---|---|
| /start e /menu | menu inline em mensagem nova, botao fixo persistente |
| menu -> area -> folha de leitura | area edita no lugar; folha manda resultado + "Dica" + botao fixo |
| escrita guiada (gastei) | valor -> descricao -> categoria -> rascunho com Confirmar/Cancelar |
| clique de folha de escrita com rascunho aberto | rascunho preservado, aviso de rascunho em andamento |
| navegacao e folha de leitura com rascunho (COLLECTING e AWAITING) | rascunho intacto |
| voltar com rascunho | cancela e mostra menu; "voltar para casa" nao sai |
| palavras: nao, ok, sim, "saldo" entre aspas, "menu pra mim" | nao saem ("Nao entendi") |
| Sair!, chega, Deixa pra la sem rascunho | "Nada para cancelar" + menu |
| clique duplicado (mesmo callback id, update novo) | 1 resposta, 1 evento, 2 answerCallbackQuery |
| callback de chat nao vinculado | so answerCallbackQuery |
| callback de grupo/supergrupo/canal; sem message | ignorado, mudo |
| callback forjado: id de usuario, 41 chars, prefixo trocado, caixa, \n, acento, vazio, ../ | 41 chars/prefixo/formato: ignorado; id valido desconhecido: menu raiz; nada vaza |
| B clica "saldo" com A tendo gasto | B ve R$ 0,00; A ve -R$ 45,00 |
| TELEGRAM_WRITES_ENABLED=false | rascunho ok; "confirmar" nao grava (0 Transaction) |
| TELEGRAM_WRITES_ENABLED=true | rascunho -> confirmar -> 1 Transaction; 2o "confirmar" nao duplica; clique nunca confirma |
| Redis pausado (docker pause) e religado | clique de vinculado segue (modo degradado); clique de nao vinculado mudo; apos unpause volta ao normal |
| 200 cliques (120 A, 40 B, 40 C) + 20 repeticoes | 0 erro 500, 0 deadlock, 0 messageId duplicado; 20 por chat processados (limite de taxa), resto descartado |
| ConversationEvent | so intent/outcome/messageId; sem texto |
| logs do backend | sem texto do usuario, sem chat id, sem token |

Limpeza: conteineres rv12-* removidos, fake e backend parados, portas sem listener; conteineres do dono (iso-placas, detect-objects, wa-akg-db, lumen-*) como estavam.

## Mutantes proprios (21)

Rodados contra src/telegram, src/conversation/menu, menu-action e menu-telegram-gate.

| id | mutante | resultado |
|---|---|---|
| M01 | notModified sempre false | morto |
| M02 | notModified sempre true | morto |
| M03 | adaptador ignora notModified | morto |
| M04 | condicao do notModified invertida | morto |
| M05 | dono = chatId | morto |
| M06 | DUPLICATE reenvia no clique | morto |
| M07 | sem Redis responde clique nao vinculado | morto |
| M08 | limite de taxa alto | morto |
| M09 | regex de id ate 400 | morto |
| M10 | regex sem ancora inicial | SOBREVIVEU, coberto (teste novo), morto |
| M11 | limite de botoes 1000 | morto |
| M12 | "nao" sai | morto |
| M13 | "ok" cancela | morto |
| M14 | id desconhecido nao cai na raiz | morto |
| M15 | clique sem checar expiracao | SOBREVIVEU, coberto (teste novo), morto |
| M16 | saida com rascunho desligada | morto |
| M17 | saida sem rascunho desligada | morto |
| M18 | folha sem dica | morto |
| M19 | navegacao sem evento | morto |
| M20 | edita parts[1] ?? parts[0] | equivalente (menu tem uma parte so; teste da 12.1b garante) |
| M21 | callback de grupo aceito | morto |

Total: 21; 19 mortos de primeira ou apos teste novo (2 sobreviventes cobertos), 1 equivalente, 0 sobreviventes abertos. (Contagem: 18 mortos de primeira + 2 cobertos = 20 mortos, 1 equivalente.)

## Numeros (2026-11-25, conferido por este revisor)

- tsc --noEmit: exit 0.
- jest src/conversation src/telegram src/whatsapp --maxWorkers=2: 41 suites, 1827 testes, verde em UTC, America/Sao_Paulo, Asia/Tokyo.
- Suite inteira TZ=UTC --maxWorkers=2: 99 suites, 3093 testes, verde.
- Testes novos e tocados (telegram, menu, menu-action, menu-telegram-gate): 15 execucoes seguidas, 169 de 169 em todas.
- graphify update .: OK.

## NAO verificado

- Bot API real do Telegram (botoes, is_persistent, texto exato do erro "message is not modified"): so a Bot API falsa. O reconhecimento usa a descricao "message is not modified" (formato documentado); se o Telegram mudar o texto, cai no fallback seguro (mensagem nova).
- Cliques concorrentes reais do mesmo chat dentro de uma instancia: impossivel pelo desenho (laco unico); corrida entre duas instancias nao testada.
- Lint (eslint) nao rodado.
- Frontend nao revisado.
- Portas fixas: nao testadas (Docker Desktop recusou a publicacao; usei portas aleatorias).
