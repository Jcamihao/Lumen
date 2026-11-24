# Brief de revisao 9b-2 + 9b-3 (branch feat/cartoes-no-bot; NUNCA troque de branch)

Voce e o REVISOR (sonnet). Fale curto (estilo caveman). Leia CLAUDE.md, ~/.claude/CLAUDE.md, o contrato docs/superpowers/specs/2026-11-24-conversa-contrato-item-9b.md, .superpowers/sdd/cartoes-no-bot-9b/{resultado-9b2,resultado-9b3,duvidas,resultado-revisao-9b1}.md. Escopo: git diff do commit 1a419f6^ ate HEAD (9b-2: leitura por cartao + "meus cartoes"; 9b-3: RENOMEAR cartao por conversa; criar cartao esta RECUSADO de proposito ate decisao do dono: so confira que a recusa e clara e nao grava).

## Verificar (REAL; Docker ligado)
- Conteineres descartaveis (docker run --rm) SO com nomes rv9d-*, portas livres com ss -ltn, Postgres 16 + Redis 7. NUNCA toque em lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000.
- Banco limpo com todas as migrations; backend nest build em porta propria; contas A, B, C com varios cartoes (incl. arquivado).
- 9b-2: "cartao X", "limite do cartao X", "quanto sobrou no X", "fatura do X", "meus cartoes": numeros do ciclo batem com /credit-cards/:id/cycle; ambiguo/inexistente lista; arquivado nao aparece; cartao de B nunca visivel para A; regressao das frases antigas (credit_card padrao, set/clear limit do 8d).
- 9b-3: renomear ponta a ponta (rascunho -> confirmar -> nome gravado, recibo); cancelar; expirar; nome duplicado sem caixa/acento; mesmo nome; vazio/longo; cartao alheio/arquivado; corrida (outro cartao ganha o nome entre rascunho e confirmacao; renomear em paralelo 2x; make-default/arquivar concorrente) sem deadlock nem gravacao dupla; falha controlada (3 resultados); renomeado aparece nas buscas da 9b-1/9b-2 e o lancamento por conversa usa o nome novo; canal Telegram (Bot API falsa): lista/rascunho bem formatados e com TELEGRAM_WRITES_ENABLED=false nada grava.
- >= 14 mutantes proprios (matcher, escolha, userId, arquivado, nome unico, gravacao). Registre mortos/sobreviventes/equivalentes e cubra os sobreviventes reais.

## Entrega
- Corrija DEFEITOS com commits separados (fix(...) em portugues, Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>), sem amend/reset/push, sem trocar de branch. Duvida de produto vai para o relatorio.
- Ao terminar: remova TODOS os conteineres/arquivos temporarios seus, confirme portas sem listener e que os conteineres do dono seguem de pe. Rode tsc, a suite inteira (--maxWorkers=2) e graphify update . na raiz.
- Escreva .superpowers/sdd/cartoes-no-bot-9b/resultado-revisao-9b23.md: veredito, achados, mutantes, verificacoes reais com numeros, NAO verificado. Se parar por limite, diga onde parou.
