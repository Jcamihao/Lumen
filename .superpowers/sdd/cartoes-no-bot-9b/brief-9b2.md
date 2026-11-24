# Brief 9b-2: leitura por cartao e "meus cartoes" (branch feat/cartoes-no-bot; NUNCA troque de branch)

Leia ANTES: CLAUDE.md da raiz, ~/.claude/CLAUDE.md, docs/superpowers/specs/2026-11-24-conversa-contrato-item-9b.md (aprovado; itens 2.3 e 2.4), .superpowers/sdd/cartoes-no-bot-9b/{resultado-9b1,resultado-revisao-9b1}.md, e o padrao existente: backend/src/conversation/credit-limit.ts, card-expense.ts, parsers/intent.matcher.ts (intent credit_card ~linha 106; set_credit_limit ~178), conversation.service.ts (case 'credit_card' ~2656, busca de cartao do 8d ~855), replies.ts (cardText), CreditCycleService.getCycleForCard.

## Escopo (so isto)
1. Leitura por cartao: "limite do Nubank", "quanto sobrou no Nubank", "quanto gastei no Nubank", "cartao Nubank", "fatura do Nubank" -> mesma resposta do intent credit_card, para o cartao nomeado (getCycleForCard), com o nome do cartao no texto. Sem nome: cartao padrao como hoje (resposta igual, sem regressao). ATENCAO: "limite do X <valor>" continua sendo o comando de escrita set_credit_limit do 8d (nao mude); "limite do X" SEM valor hoje cai em ajuda/IA (ver comentario ~linha 191 do matcher): agora, se X casa com um cartao do dono, vira leitura do cartao; se nao casa, comportamento de hoje.
2. Nome inexistente/ambiguo na leitura: responde com a lista de cartoes ativos (padrao CL_REPLIES), sem erro.
3. "meus cartoes" / "quais cartoes" / "listar cartoes" / "meus cartoes de credito": lista os cartoes ativos (nome, qual e o padrao, dia de fechamento e vencimento quando houver). Somente leitura, ordem: padrao primeiro, depois por nome. Resposta curta; no Telegram/WhatsApp ja sai pelo adaptador existente.
4. Sempre por userId do vinculo autenticado; cartao alheio = igual a inexistente; cartao arquivado nao aparece.
5. Sem mudanca de schema/migration. Nao tocar na escrita (9b-1) nem no 8d.

## Testes
Unitarios (matcher: frases novas e regressao de TODAS as frases existentes de credit_card/set_credit_limit/clear_credit_limit; service: nome casa, inexistente, ambiguo, padrao, arquivado, isolamento A/B/C com isolation.fixture.ts). Mutantes >= 8 proprios (registre mortos/sobreviventes/equivalentes e cubra sobreviventes).
Rode: cd backend && npx tsc --noEmit && npx jest src/conversation src/credit-cards src/transactions src/telegram --maxWorkers=2 em TZ=UTC, America/Sao_Paulo e Asia/Tokyo; depois a suite inteira (--maxWorkers=2) uma vez; graphify update . na raiz.

## Regras
Comentarios em portugues sem acentos no codigo. NAO toque nos containers lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000; sem Docker nesta fatia. Commits separados com caminhos explicitos (feat; test; docs), Conventional Commits em portugues, Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>. Nunca amend/reset/push. Duvida de produto: registre em duvidas.md, nao decida. Termine com .superpowers/sdd/cartoes-no-bot-9b/resultado-9b2.md (mudancas, comandos e numeros, mutantes, NAO verificado). Nao pergunte nada.
