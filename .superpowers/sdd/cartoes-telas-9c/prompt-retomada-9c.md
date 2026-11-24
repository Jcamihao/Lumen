Voce assume o item 9c do Lumen (telas dos cartoes). Fale curto (caveman). Siga ~/.claude/CLAUDE.md (regras gerais) e o CLAUDE.md do repo. Sem push, sem deploy, sem apagar branch remota. Nunca amend/reset. Commits separados, caminhos explicitos, Conventional Commits em portugues.

## Onde esta
- Repo: /home/caminhao/coding/codeStage/Lumen (pasta principal), branch feat/cartoes-telas-9c (so local), arvore limpa, HEAD 2a29e4f. Base: develop na epoca do v1.17.0.
- Contrato aprovado pelo dono: docs/superpowers/specs/2026-11-24-conversa-contrato-item-9c.md (7 decisoes "sim em todas"). Contrato 9 (API de cartoes): docs/superpowers/specs/2026-11-23-conversa-contrato-item-9.md. Bot (9b, ja na develop, v1.17.0): docs/superpowers/specs/2026-11-24-conversa-contrato-item-9b.md.
- Feito e REVISADO (sonnet, Chrome real + Postgres/Redis descartaveis + mutantes): 9c-1a (tela de Cartoes na card-page) e 9c-1b (seletor de cartao em lancamento/parcelado/conta fixa, cardName e filtro nas listas, abas do ciclo, teto por aba, rascunhos CARD_CREATE/CARD_RENAME no assistente, menu Telegram cartoes + correcao de /saldo /gastos /ajuda). Relatorios: .superpowers/sdd/cartoes-telas-9c/resultado-9c1a.md, resultado-9c1b.md, resultado-revisao-9c1a.md, resultado-revisao-9c1b.md.
- Feito e CONFERIDO pelo agente principal, mas SEM revisao do sonnet: 9c-1c (DELETE /credit-cards/:id/ceiling com clearCeiling compartilhado com o "limpar limite" do bot; botao "Limpar teto" em 2 etapas no card do ciclo). Numeros conferidos em 2026-11-24: tsc limpo; jest credit-cards/credit-cycle/conversation/telegram 1177 verdes (UTC e Asia/Tokyo); ng build ok; ng test 531 SUCCESS. Resultado do haiku: .superpowers/sdd/cartoes-telas-9c/resultado-9c1c.md.
- A revisao da 9c-1c foi interrompida DUAS vezes (limite de uso e queda de sessao) sem deixar nada commitado nem conteineres. O brief esta pronto: .superpowers/sdd/cartoes-telas-9c/brief-revisao-9c1c.md.

## Proximo passo (nesta ordem)
1. Rodar a revisao da 9c-1c: um revisor (sonnet; se for o OpenCode/Qwen, ele faz tudo sozinho conforme a regra do dono) executa o brief-revisao-9c1c.md: Postgres 16 + Redis 7 descartaveis (docker run --rm, nomes rv9h-*, portas livres com ss -ltn), backend real, Chrome real headless (libs: apt-get download libnspr4 libnss3 libasound2t64 + dpkg -x numa pasta temporaria + LD_LIBRARY_PATH; apagar no fim), concorrencia do DELETE x PUT ceiling x make-default x arquivar x limpar limite do bot (100+ rodadas), fluxo ponta a ponta da 9c-1 inteira, >= 12 mutantes. Corrige defeitos e escreve .superpowers/sdd/cartoes-telas-9c/resultado-revisao-9c1c.md.
2. Conferencia independente do agente principal (tsc, jest nos 3 fusos TZ=UTC/America/Sao_Paulo/Asia/Tokyo, ng build, ng test).
3. Trazer a develop para a branch (git merge develop; a develop andou: ha trabalho do item 11/billing, branch feat/billing-grupos-11a1 no worktree ../Lumen-item8a2). Resolver conflitos sem perder nada, rodar tudo de novo.
4. Merge --no-ff da feat/cartoes-telas-9c na develop. A develop esta aberta no worktree /home/caminhao/coding/codeStage/Lumen-item8: faca o merge la, sem tocar nas mudancas sem commit do OpenCode (backend/package.json e package-lock.json). Depois: nota docs/releases/v1.18.0.md, tag anotada v1.18.0 (so local), atualizar docs/HANDOFF.md (ponto de retomada, o que foi integrado, o que falta, limitacoes), apagar a branch local feat/cartoes-telas-9c. NAO recriar a branch deploy (o dono mandou apagar).
5. Depois do merge, 9c-2 (fatia propria, so com contrato aprovado pelo dono): remover monthClosingDay, creditDueDay e creditCycleCountAllPayments do User (migration; cadastro passa a criar so o cartao Principal; tirar o espelho da 9a). Antes de rodar em producao: rodar o SELECT do resultado-9a3.md (dado fora de 1..31). Branch nova fix/ ou feature/ a partir da develop atualizada.

## Duvidas de produto abertas (nao decida; pergunte ao dono, recomendacao entre parenteses)
- Offline, as abas do ciclo continuam visiveis e dao erro ao clicar (aceitar por enquanto).
- /start e "/cartao nubank" no Telegram caem em "Nao entendi" (aceitar).
- Esc descarta o digitado, igual Cancelar (aceitar). Sem cache offline da lista de cartoes (aceitar). Texto do erro de 10 cartoes (aceitar).
- Teto e escopo do cartao padrao ficam duplicados na tela de Cartoes e no card do ciclo (manter ate a 9c-2).

## Armadilhas
- NAO toque nos conteineres lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000, 4200. Integracao so em descartavel, derrubado no fim, portas sem listener.
- Prisma 5.22 engole falha de COMMIT (risco antigo; limitacao aceita).
- Indices unicos parciais de CreditCard existem so na SQL: nunca rodar prisma migrate dev sem revisar (ele propoe remove-los).
- Nunca git checkout/switch para outra branch dentro da pasta principal enquanto houver subagente trabalhando (ja houve incidente: haiku trocou para a branch deploy e commitou la).
- Ordem de locks do backend: linha do User (FOR NO KEY UPDATE) -> cartao -> lancamento/teto.
- graphify update . na raiz depois de mexer em codigo. Registrar numeros verdes com data e quem conferiu; manter secao NAO verificado.
- Item 11 (billing: planos e plano Compartilhado/Familia) esta no handoff da develop; contrato proprio, decisoes do dono; nao misturar com a 9c.
