# Brief 9b-1: lancar despesa no cartao pela conversa (branch feat/cartoes-no-bot)

Leia ANTES: CLAUDE.md da raiz, ~/.claude/CLAUDE.md, docs/superpowers/specs/2026-11-24-conversa-contrato-item-9b.md (aprovado), docs/superpowers/specs/2026-11-23-conversa-contrato-item-9.md e o padrao do 8d: backend/src/conversation/credit-limit.ts (matchCardsByTerm, ChatCard, cleanCardTerm), conversation.service.ts (startCreditLimitDraft, busca de cartao ~linha 855, draft pending/ASK, confirmacao ~2462 e ~3277), conversation.types.ts (ExpenseOrIncomeDraft, linha 80), replies.ts. Backend: backend/src/credit-cards/card-link.ts (resolveCardForCreate, withCardGuard).

## Escopo (so isto)
1. Despesa (EXPENSE) com trecho "no/na/do/da <cartao>" (ou "no credito <cartao>"): se o termo casa com um cartao ATIVO do dono (matchCardsByTerm, sem acento/caixa), o rascunho ganha paymentMethod=CREDIT + cardId + cardName, e o texto do rascunho e do recibo mostram o cartao. "no mercado" continua descricao se NAO casar com cartao (nada muda para quem nao tem esse nome).
2. Termo que parece cartao explicito ("no cartao X", "no credito X") mas nao existe, ou ambiguo: NAO grava; responde com a lista de cartoes ativos (padrao CL_REPLIES).
3. "credito" sem nome: com 1 cartao ativo usa ele e mostra o nome; com mais de um, o rascunho fica pendente e responde com a LISTA numerada/por nome; a resposta seguinte escolhe (como campo pendente dos outros rascunhos). Sem credito na frase: nada muda (paymentMethod null).
4. Receita nao aceita cartao (ignora o trecho, nao e erro).
5. Na confirmacao: gravar pelo mesmo caminho da tela (TransactionsService.create com cardId, que usa withCardGuard/resolveCardForCreate). Cartao arquivado/removido entre rascunho e confirmacao: recusa clara, nada gravado; os 3 resultados de gravacao e o recibo (com cardName) preservados. Cartao sempre buscado com userId do vinculo autenticado; alheio = igual a inexistente.
6. Sem mudanca de schema/migration.

## Testes
Unitarios (parser e service): casa/nao casa, acentos, ambiguo, inexistente, 1 cartao vs varios, receita, arquivado na confirmacao, isolamento A/B/C (reaproveite isolation.fixture.ts; acrescente cartoes de B e prove que A nunca ve nem usa). Mutantes >= 8 proprios (registre mortos/sobreviventes/equivalentes e cubra sobreviventes).
Rode: cd backend && npx tsc --noEmit && npx jest src/conversation src/credit-cards src/transactions --maxWorkers=2 em TZ=UTC, America/Sao_Paulo e Asia/Tokyo; depois a suite inteira (--maxWorkers=2) uma vez; graphify update . na raiz.

## Regras
Comentarios em portugues sem acentos no codigo. NAO toque nos containers lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000; nao use Docker nesta fatia (integracao real e da revisao). Commits separados com caminhos explicitos (feat; test; docs), Conventional Commits em portugues, com Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>. Nunca amend/reset/push. Duvida de produto: registre em duvidas.md, nao decida. Termine com .superpowers/sdd/cartoes-no-bot-9b/resultado-9b1.md (mudancas, comandos e numeros, mutantes, NAO verificado). Nao pergunte nada.
