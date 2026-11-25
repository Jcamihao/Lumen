# Brief de revisao 9c-1b (branch feat/cartoes-telas-9c; NUNCA troque de branch)

Voce e o REVISOR (sonnet). Fale curto (caveman). Leia CLAUDE.md, ~/.claude/CLAUDE.md, docs/superpowers/specs/2026-11-24-conversa-contrato-item-9c.md, .superpowers/sdd/cartoes-telas-9c/{brief-9c1b,resultado-9c1b,resultado-revisao-9c1a,duvidas}.md. Escopo: git diff c10a972..HEAD. Fora do escopo: limpar teto por cartao (sem rota na API; aguarda decisao do dono).

## Verificar (REAL; Docker ligado)
- Conteineres descartaveis (docker run --rm) SO com nomes rv9g-*, portas livres com ss -ltn, Postgres 16 + Redis 7. NUNCA toque em lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000, 4200.
- Banco limpo com todas as migrations; backend nest build; app Angular em porta propria; CHROME REAL headless (puppeteer-core; libs: apt-get download libnspr4 libnss3 libasound2t64, dpkg -x numa pasta sua, LD_LIBRARY_PATH; apague no fim). Contas A e B (A com 1 cartao e A2 com 3 cartoes).
- Navegador: com 1 cartao nao ha seletor/abas/filtro; com 3 cartoes: seletor so com despesa+credito (some em receita/PIX/debito), padrao marcado, lancamento/parcelado/conta fixa gravam o cardId certo (confira no banco), cardName nas listas, filtro por cartao (Todos/um), abas do ciclo (numeros batem com /credit-cards/:id/cycle), definir/alterar teto por aba (banco confere; 400/409/404; envio duplo; backend derrubado = resultado desconhecido sem nova tentativa), aba do padrao igual ao de hoje; B nunca ve cartao de A; cartao arquivado nao e oferecido.
- Assistente (chat do app): "criar cartao X" -> pergunta fechamento -> rascunho CARD_CREATE renderizado e confirmavel; renomear (CARD_RENAME); escolha de cartao no lancamento por conversa. Confira no banco.
- Telegram: menu tem cartoes; '/cartao' e '/cartoes' chegam ao motor como "cartao"/"meus cartoes" (Bot API falsa).
- Screenshots 390 e 1280 px, claro e escuro: LEIA as imagens (sem corte/sobreposicao), teclado Tab/Enter/Esc.
- >= 14 mutantes proprios. Registre mortos/sobreviventes/equivalentes e cubra os sobreviventes reais.

## Entrega
- Corrija DEFEITOS com commits separados (fix(...) em portugues, Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>), sem amend/reset/push, sem trocar de branch. Duvida de produto vai para o relatorio.
- Ao terminar: remova TODOS os conteineres/arquivos temporarios seus (inclusive libs), confirme portas sem listener e que os conteineres do dono seguem de pe. Rode ng build, ng test, tsc + jest telegram/conversation nos 3 fusos, graphify update . na raiz.
- Escreva .superpowers/sdd/cartoes-telas-9c/resultado-revisao-9c1b.md: veredito, achados, mutantes, verificacoes reais com numeros, NAO verificado. Se parar por limite, diga onde parou.
