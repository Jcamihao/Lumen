# Brief de revisao 9c-1a: tela de Cartoes (branch feat/cartoes-telas-9c; NUNCA troque de branch)

Voce e o REVISOR (sonnet). Fale curto (caveman). Leia CLAUDE.md, ~/.claude/CLAUDE.md, docs/superpowers/specs/2026-11-24-conversa-contrato-item-9c.md, .superpowers/sdd/cartoes-telas-9c/{brief-9c1a,resultado-9c1a,duvidas}.md. Escopo: git diff 5fcbc72..HEAD. Decisoes do dono: card-page vira lista de cartoes (criar, editar nome/fechamento/vencimento, tornar padrao, arquivar com 2 etapas, mostrar arquivados sem desarquivar); padrao nao arquiva; teto 10; offline sem criar/editar.

## Verificar (REAL; Docker ligado)
- Conteineres descartaveis (docker run --rm) SO com nomes rv9f-*, portas livres com ss -ltn, Postgres 16 + Redis 7. NUNCA toque em lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000, 4200.
- Banco limpo com todas as migrations; backend nest build em porta propria; app Angular servido (ng serve/build em porta propria) e CHROME REAL headless (puppeteer-core com o Chrome do cache do puppeteer; faltam libs do sistema: baixe com apt-get download libnspr4 libnss3 libasound2t64, extraia com dpkg -x numa pasta sua e use LD_LIBRARY_PATH; apague no fim).
- Contas A e B. Roteiro no navegador: login; abrir Cartoes; lista com Principal (padrao); criar cartao (nome, fechamento, vencimento); nome repetido (409 em texto, sem perder o digitado); fechamento 0/32; editar; tornar padrao (selo muda); arquivar (2 etapas, cancelar, confirmar); padrao com botao desabilitado e texto; interruptor arquivados; chegar a 10 ativos e ver o botao criar desabilitado; B nao ve cartoes de A; erro de rede (derrube o backend) mostra "Tentar de novo" e volta; conferir no banco que cada acao gravou certo. Capture screenshots em 390 e 1280 px, claro e escuro, e LEIA-os (Read nas imagens): sem texto cortado, sem sobreposicao, foco visivel, teclado (Tab/Enter/Esc) funcionando.
- O que a card-page fazia antes (fechamento do cartao padrao, teto e escopo) continua funcionando.
- >= 12 mutantes proprios no componente/servico. Registre mortos/sobreviventes/equivalentes e cubra os sobreviventes reais.

## Entrega
- Corrija DEFEITOS com commits separados (fix(...) em portugues, Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>), sem amend/reset/push, sem trocar de branch. Duvida de produto vai para o relatorio.
- Ao terminar: remova TODOS os conteineres/arquivos temporarios seus (inclusive as libs), confirme portas sem listener e que os conteineres do dono seguem de pe. Rode ng build, ng test (suite inteira) e graphify update . na raiz.
- Escreva .superpowers/sdd/cartoes-telas-9c/resultado-revisao-9c1a.md: veredito, achados, mutantes, verificacoes reais com numeros, NAO verificado. Se parar por limite, diga onde parou.
