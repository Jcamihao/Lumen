# Brief 9b-3b: criar cartao pela conversa (branch feat/cartoes-no-bot; NUNCA troque de branch)

Decisao do dono (2026-11-24, "A"): o bot PERGUNTA o dia de fechamento antes de confirmar. Regras do item 9 (contrato 2026-11-23): closingDay obrigatorio 1..31; dueDay opcional 1..31; countAllPayments false; cartao novo nao vira padrao; teto 10 ativos; nome 1..40 unico sem caixa/acento entre ativos.
Decisoes do dono tambem (recomendacoes): duvidas 8, 9, 10 de duvidas.md ficam como estao.

Leia ANTES: CLAUDE.md da raiz, ~/.claude/CLAUDE.md, docs/superpowers/specs/2026-11-24-conversa-contrato-item-9b.md (secao 7), .superpowers/sdd/cartoes-no-bot-9b/{resultado-9b3,resultado-revisao-9b23,duvidas}.md, backend/src/conversation/card-write.ts (rascunho de renomear e a recusa atual de criar), credit-limit.ts, o padrao de campo pendente dos rascunhos (ex.: ExpenseOrIncomeDraft/ASK, escolha de cartao da 9b-1), credit-cards.service.ts (create).

## Escopo (so isto)
1. "criar/novo/adicionar/cadastrar cartao <nome>" -> valida nome (vazio, >40, duplicado entre ativos, teto de 10: recusa clara sem rascunho, como no renomear) e abre rascunho CREDIT_CARD_CREATE com campo pendente "dia de fechamento". Pode vir na frase: "criar cartao Nubank fecha dia 10" / "fechamento 10" / "vence dia 17" (aceite essas formas; vencimento opcional na frase).
2. Pergunta: "Qual o dia de fechamento do Nubank (1 a 31)?". Resposta so numero 1..31 (aceite "dia 10", "10"); invalido repete a pergunta sem sair do rascunho. Vencimento: NAO perguntar; se vier na frase usa, senao fica vazio (nas telas depois). Mostrar no resumo: nome, fechamento, vencimento (ou "sem vencimento"), "nao sera o cartao padrao".
3. Confirmar: grava pelo CreditCardsService.create (mesmo caminho da API, sem regra nova), recibo com id/nome/closingDay/dueDay, texto "Cartao <nome> criado, fecha dia X". Reconferir sob lock (nome tomado, teto de 10 atingido entre rascunho e confirmacao -> recusa clara, nada gravado; 409/limite da API mapeado em texto). 3 resultados de gravacao como no renomear; gate TELEGRAM_WRITES_ENABLED continua valendo (nada grava, orienta o app).
4. Cartao criado aparece nas buscas das 9b-1/9b-2 e em "meus cartoes". Sempre userId do vinculo autenticado. Remova a recusa antiga de criar e seus testes/textos; mantenha o resto do renomear intacto. Sem schema/migration. Fora: arquivar, padrao, dueDay por pergunta.

## Testes
Matcher (frases novas + regressao), service (nome valido/duplicado/vazio/longo/teto10, fechamento na frase e por pergunta, invalido repete, cancelar, expirar, confirmar, corrida de nome e de teto, resultado desconhecido, isolamento A/B/C com isolation.fixture.ts, gate Telegram). Mutantes >= 10 proprios (registre mortos/sobreviventes/equivalentes e cubra sobreviventes).
Rode: cd backend && npx tsc --noEmit && npx jest src/conversation src/credit-cards src/transactions src/telegram --maxWorkers=2 em TZ=UTC, America/Sao_Paulo e Asia/Tokyo; suite inteira (--maxWorkers=2) uma vez; os specs novos 15 vezes seguidas; graphify update . na raiz.

## Regras
Comentarios em portugues sem acentos no codigo. Fale curto (caveman). NAO toque nos containers lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000; sem Docker nesta fatia. Commits separados com caminhos explicitos (feat; test; docs), Conventional Commits em portugues, Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>. Nunca amend/reset/push. Duvida de produto: duvidas.md, nao decida. Termine com .superpowers/sdd/cartoes-no-bot-9b/resultado-9b3b.md (mudancas, comandos e numeros, mutantes, NAO verificado). Nao pergunte nada.
