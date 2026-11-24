# Brief de revisao 9c-1c: limpar teto por cartao (branch feat/cartoes-telas-9c; NUNCA troque de branch)

Voce e o REVISOR (sonnet). Fale curto (caveman). Leia CLAUDE.md, ~/.claude/CLAUDE.md, docs/superpowers/specs/2026-11-24-conversa-contrato-item-9c.md, .superpowers/sdd/cartoes-telas-9c/{brief-9c1c,resultado-9c1c,resultado-revisao-9c1b}.md. Escopo: git diff 56d7d91..HEAD (rota DELETE /credit-cards/:id/ceiling com metodo clearCeiling compartilhado com o bot + botao "Limpar teto" no card do ciclo). ITEM DE CONCORRENCIA/ISOLAMENTO: foque nele.

## Verificar (REAL; Docker ligado)
- Conteineres descartaveis (docker run --rm) SO com nomes rv9h-*, portas livres com ss -ltn, Postgres 16 + Redis 7. NUNCA toque em lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000, 4200.
- Banco limpo com todas as migrations; backend nest build; app Angular em porta propria; CHROME REAL headless (puppeteer-core; libs: apt-get download libnspr4 libnss3 libasound2t64, dpkg -x numa pasta sua, LD_LIBRARY_PATH; apague no fim). Contas A (3 cartoes), B.
- API real: DELETE ceiling ok (banco confere: teto removido so do cartao certo), sem teto = 409, arquivado = 409, cartao de B = 404 (igual a inexistente), sem token = 401; recibo; concorrencia (DELETE x PUT ceiling x make-default x arquivar x "limpar limite" do bot em paralelo, 100+ rodadas): sem deadlock, sem 500, sem gravacao dupla; ordem de locks User -> cartao -> teto; o "limpar limite" do bot (8d) continua identico (regressao).
- Chrome: botao so com teto, online e 2+ cartoes; 2 etapas (Confirmar/Cancelar/Esc); salvando; erro de rede (derrube o backend) = resultado desconhecido sem repetir; recarrega o ciclo; aba do padrao; screenshots 390 e 1280 px, claro e escuro: LEIA as imagens.
- Fluxo ponta a ponta final da 9c-1 inteira (a branch vai ser mergeada): lista de cartoes -> criar -> lancamento com cartao -> aba do ciclo -> definir teto -> limpar teto -> assistente "meus cartoes". Confira o banco.
- >= 12 mutantes proprios (rota, clearCeiling, lock, guarda de arquivado, botao). Registre mortos/sobreviventes/equivalentes e cubra os sobreviventes reais.

## Entrega
- Corrija DEFEITOS com commits separados (fix(...) em portugues, Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>), sem amend/reset/push, sem trocar de branch. Duvida de produto vai para o relatorio.
- Ao terminar: remova TODOS os conteineres/arquivos temporarios seus (inclusive libs), confirme portas sem listener e que os conteineres do dono seguem de pe. Rode ng build, ng test, tsc + jest (credit-cards, credit-cycle, conversation, telegram) nos 3 fusos, a suite inteira do backend (--maxWorkers=2) e graphify update . na raiz.
- Escreva .superpowers/sdd/cartoes-telas-9c/resultado-revisao-9c1c.md: veredito, achados, mutantes, verificacoes reais com numeros, NAO verificado. Se parar por limite, diga onde parou.
