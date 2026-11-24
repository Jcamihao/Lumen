# Resultado da revisao 9b-2 e 9b-3 (leitura por cartao, "meus cartoes", renomear cartao pela conversa)

Data: 2026-11-24. Revisor: Claude Sonnet 5.5 (sessao unica, sem subagentes). Branch feat/cartoes-no-bot (sem troca). Escopo: 1a419f6^..HEAD (inclui o codigo da 9b-2 em 2d92344).

## Veredito
APROVADO COM 1 DEFEITO CORRIGIDO e 1 mutante sobrevivente coberto. Leitura por cartao, lista, renomear (rascunho, confirmar, cancelar, expirar), corridas, falha controlada, isolamento A/B/C e canal Telegram funcionam em banco real. Criar cartao segue RECUSADO (clara, sem rascunho, nada gravado).

## Achados
1. DEFEITO (corrigido, 6bc33a6 + cde5968): renomear aceitava nome que so difere no acento ou na pontuacao final de outro cartao ativo ("Róxinho" ao lado de "Roxinho", "Nubank!" ao lado de "Nubank"). A API so barra igual sem caixa, mas a busca do chat compara sem acento: os dois cartoes viram "mais de um cartao bate" para sempre, e nenhum dos dois pode ser escolhido por nome (leitura, lancamento, limite). Reproduzido em banco real antes da correcao (rascunho de "Róxinho" aceito). Correcao: nameTakenBy tambem compara pelo nome normalizado (sem acento/caixa/pontuacao final; chave vazia nao conta); a conferencia vale no rascunho e de novo na confirmacao (antes do update, fora do lock; janela minima). Trocar so acento/caixa do PROPRIO cartao segue permitido. Conferido em banco real depois da correcao.
2. Lacuna de teste (corrigida, 1632e37): o fake do credit-limit-change.spec assume archivedAt null quando o where nao diz nada, entao o mutante "resolveChatCard (8d) sem filtro de arquivado" sobrevivia. Teste novo no motor (fake que honra where): definir limite do cartao arquivado ou alheio responde "nao achei". Em banco real o comportamento ja estava certo.
3. Observacao (pre-existente, nao e da 9b): com falha NO COMMIT (gatilho deferrable no Postgres), o Prisma 5.22 devolve sucesso sem persistir. O PATCH /credit-cards/:id tambem responde 200 com o nome novo e o banco fica com o antigo; a conversa herda isso e diz "renomeado". Mesmo risco ja registrado na revisao 9b-1. O ramo "resultado desconhecido" so existe em teste unitario.
4. Observacao (produto): renomear em dois canais ao mesmo tempo (APP e Telegram, mesmo cartao, nomes diferentes): as duas confirmacoes dao recibo, vence a ultima, sem duplicar nome. O recibo da segunda diz "Cartao Tele renomeado para NomeTg" mesmo ja tendo virar NomeApp (o rascunho guarda o nome da hora). Sem dano; aceitavel.
5. Observacao (produto): cartao com nome de mais de uma palavra ("Itau Azul") nao serve no lancamento "no cartao itau azul farmacia" (o termo do lancamento e uma palavra; "itau" empata Itau Azul/Itau Gold). Leitura ("cartao itau azul") e renomear aceitam nome completo. E da 9b-1, so registrado.
6. Observacao (produto): leitura nomeada sem teto mostra so "Nao ha limite definido neste ciclo do cartao", sem o gasto (ex.: "quanto gastei no inter" com R$ 30 gastos). Texto herdado do 8d; ligado a duvida 6.
7. Observacao: "limite do cartao nubank 500" (com valor) cai na leitura do cartao PADRAO ("Nao ha limite..." do Principal); a escrita do 8d e "definir limite do nubank 500". Pre-existente.
8. Cosmetico: texto de rascunho expirado diz "Envie o lancamento de novo" tambem para renomear (texto generico).
Duvidas 4 a 10 do dono seguem abertas; nada decidido por mim.

## Verificacoes reais (Postgres 16 e Redis 7 descartaveis rv9d-pg:15551 e rv9d-redis:16551; backend nest build em 13211; Bot API falsa em 13221)
Banco novo com as 32 migrations. A (Principal, Nubank, Itau Azul, Itau Gold, Inter, Velho arquivado), B (Principal, Bradesco, Segredo B), C (so Principal; depois arquivado por SQL).
- 9b-2: "cartao nubank", "limite do cartao nubank", "quanto sobrou no cartao nubank", "fatura do nubank", "quanto sobrou no nubank", "limite do nubank": usado R$ 127,00, limite R$ 500,00, disponivel R$ 373,00 = /credit-cards/:id/cycle (spent 127, ceiling 500, remaining 373). Inter: gastou 30, sem teto. Ambiguo ("itau") e inexistente ("xpto") listam; arquivado ("velho") responde igual a inexistente; forma sem a palavra cartao com nome que nao e cartao ("limite do velho", "fatura do nuban") segue o caminho de hoje ("Nao entendi"). "meus cartoes", "quais cartoes", "listar cartoes", "meus cartoes de credito": padrao primeiro e depois por nome, fechamento e vencimento. Sem nome ("cartao", "quanto sobrou no cartao", "limite do cartao 2000"): padrao como antes. Acento e caixa ("cartao NUBANK", "cartão Nübank") ok. B nunca ve Nubank de A (nao achei, lista so de B); A nunca ve Bradesco/Segredo B; B le Bradesco (999 = cycle); C so ve o Principal; C sem cartao ativo (SQL): "Voce ainda nao tem cartao ativo." para lista, leitura e renomear. API do cycle de A com token de B: 404.
- Regressao 8d: "definir limite do nubank 500" (rascunho, confirmar) e "limpar limite do nubank" (rascunho, confirmar com clear) ok; lancamentos "no cartao nubank/inter" e "no credito padaria" ok; "definir limite do velho 100" (arquivado) e "do bradesco" (alheio) = nao achei; "do itau" = ambiguo.
- 9b-3 ponta a ponta: "renomear cartao nubank para Roxinho" gera rascunho (Cartao / Novo nome, confirmar/cancelar), confirmar grava, recibo "Cartao Nubank renomeado para Roxinho." com data.cardId igual ao id do cartao; "cartao roxinho", "meus cartoes" e "gastei 5 no cartao roxinho teste" (grava CREDIT com o nome novo) usam o nome novo; "cartao nubank" passa a nao achar. Cartao padrao renomeado (C: Principal para Casa) mantem isDefault e volta.
- Recusas sem rascunho e sem gravar: nome so de caixa duplicado (ROXINHO), mesmo nome, vazio, sem "para" ("Nao entendi"), sem termo, 41 caracteres (40 aceito), cartao alheio, arquivado, ambiguo, inexistente, sem cartao. Aceitos: so caixa do proprio cartao ("INTER"), "Para Viagem", "mudar nome do cartao ... para ...", "R&D <b>x". "renomear meta carro para Carro Novo" nao vira cartao. "criar cartao Teste" e "novo cartao Teste fechamento 10": recusa clara, 0 cartoes novos (contagem no banco).
- Cancelar: "Rascunho cancelado. Nada foi gravado.", nome intacto. Expirar (expiresAt vencido por SQL): confirmar devolve EXPIRED e nada grava, sessao IDLE.
- Corridas: nome tomado por PATCH entre rascunho e confirmacao: "Ja existe um cartao com este nome. Nada foi alterado.", sessao IDLE, so 1 cartao com o nome. Confirmar 3x em paralelo: 1 DONE e 2 DUPLICATE, 1 linha. Confirmar x make-default em paralelo (3 rodadas): rename aplicado, 1 padrao ativo, sem erro. Confirmar x arquivar em paralelo (3 rodadas): "Cartao arquivado nao pode ser renomeado", arquivado com o nome antigo. Confirmar x PATCH para o mesmo nome (6 rodadas): sempre 1 vencedor, 1 linha com o nome, nenhum 500. Sem deadlock (0 ocorrencias no log do backend). APP e Telegram renomeando o mesmo cartao ao mesmo tempo: vide achado 4.
- Falha controlada (gatilho no Postgres): (a) falha ANTES do commit (before update): "Nao consegui renomear o cartao. O rascunho foi mantido; tente confirmar de novo.", sessao AWAITING_CONFIRMATION, 0 linhas alteradas; retirado o gatilho, confirmar de novo grava ("nao persistiu comprovadamente" = ok). (b) falha NO commit (constraint trigger deferrable): ver achado 3, nao e especifico da 9b-3. (c) resultado desconhecido: so unitario.
- Telegram (adapter real + Bot API falsa, vinculo por codigo): "meus cartoes" e "cartao roxinho" chegam formatados; rascunho de renomear chega com texto, linhas em negrito e teclado confirmar/cancelar; confirmar com TELEGRAM_WRITES_ENABLED=true grava e responde o recibo; nome "R&D <b>x" chega escapado (sem virar tag); cancelar ok. Com TELEGRAM_WRITES_ENABLED=false: o rascunho aparece, "confirmar" responde "Para gravar, confirme no app..." e o banco fica igual (sessao TELEGRAM em AWAITING_CONFIRMATION).
- Depois da correcao do achado 1 (backend recompilado): "Nômetg" e "NomeTg!" para outro cartao = "Ja existe um cartao com este nome"; o proprio cartao para "Nômetg" = rascunho.

## Mutantes (26 rodados; suites src/conversation + src/credit-cards, 991 testes)
Mortos 25, sobrevivente real 1 (agora morto), equivalentes 0. Mutantes restaurados por escrita do conteudo original; git limpo apos cada rodada.
Mortos: R1 novo nome sem espacos; R2 limite 40 vira >=; R3 nameTakenBy sem excecao do proprio; R4 sem comparacao normalizada (cobre a correcao); R5 mesmo nome nunca recusado; R6 ambiguo pega o primeiro; R7b activeCards inclui arquivado; R8b activeCards sem userId; R9 lista sem userId; R10 grava o nome atual; R11 "renomear" sem exigir "para"; R12 sem "cadastrar cartao"; R13 "renomear meta" vira cartao; R14 leitura aceita valor na frase; R15 busca sem prioridade da igualdade; R16 lista sem "(padrao)"; R17 409 vira texto generico; R18 loose aceita nome nao exato; R19 leitura nomeada usa getCurrent; R20 resultado desconhecido nao reconhecido; R21 API update ignora arquivado; R22 API update sem nome livre; R23 criar cartao grava; R24 recheck da confirmacao removido; R26 lista inclui arquivado.
Sobrevivente: R25 (resolveChatCard do 8d sem filtro de arquivado; mutantes R7/R8 da primeira rodada atingiram sem querer o mesmo trecho). Causa: o fake do credit-limit-change.spec trata archivedAt ausente como null. Coberto por teste novo no motor (morto agora).
Primeira rodada: R7 e R8 mutaram o resolveChatCard (primeira ocorrencia do texto), nao o activeCards; refeitos por numero de linha como R7b e R8b.

## Numeros verdes (2026-11-24, conferido por Claude Sonnet 5.5)
- npx tsc --noEmit: limpo.
- conversation + credit-cards + transactions + telegram: 36 suites, 1119 testes verdes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo (antes da revisao: 1113; +6 testes novos).
- Suite inteira (--maxWorkers=2, TZ=UTC): 90 suites, 2246 testes verdes (antes: 2240).
- card-write.spec e card-write.service.spec repetidos 15 vezes seguidas: 0 falhas.
- graphify update .: ok.

## Commits desta revisao
6bc33a6 fix(conversa): renomear cartao recusa nome igual so no acento ou na pontuacao final; cde5968 test (nome parecido); 1632e37 test (limite por nome, arquivado e alheio); mais este relatorio.

## NAO verificado
- Falha NO commit com resultado desconhecido real: o Prisma 5.22 engole a falha (achado 3); so teste unitario cobre o ramo.
- WhatsApp com renomear e com leitura por cartao (so APP e Telegram em banco real).
- Telegram com a trava ligada fechando outras escritas alem de renomear (so renomear).
- Mais de 10 cartoes ativos e criar cartao (recusado de proposito; nao ha escrita para testar).
- Corrida por indice unico parcial sem passar pelo lock (so via API e conversa, que usam o lock).
- Frontend (DraftView.kind sem 'CARD_RENAME'; tela e 9c). Lint e prettier nao rodados.
- Nome com emoji ou caracteres de controle no nome novo (a API aceita; nao testado).

## Limpeza
Containers rv9d-pg e rv9d-redis parados (--rm), backend e Bot API falsa encerrados, scripts temporarios removidos; portas 15551, 16551, 13211 e 13221 sem listener. detect-objects (8000) e wa-akg-db (3306) seguiram de pe; lumen-postgres-1 e lumen-redis-1 ja estavam parados antes (nao tocados).

## Proximos passos
1. Dono decide as duvidas 4 a 10 (inclui criar cartao: perguntar fechamento ou manter a recusa).
2. Conferencia independente do agente principal.
3. Merge na develop (--no-ff) e atualizar o handoff.
