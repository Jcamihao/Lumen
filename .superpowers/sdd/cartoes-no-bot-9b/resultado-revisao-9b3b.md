# Resultado da revisao 9b-3b (criar cartao pela conversa)

Data: 2026-11-24. Revisor: Claude Sonnet 5.5 (sessao unica, sem subagentes). Branch feat/cartoes-no-bot (sem troca). Escopo: git diff fba0031..HEAD.

## Veredito
APROVADO. Nenhum defeito de codigo encontrado em banco real. 3 lacunas de teste (mutantes sobreviventes) cobertas por teste novo. 4 observacoes de produto para o dono (nada decidido por mim).

## Achados
1. Lacuna de teste (corrigida): sem teste da borda de 40 caracteres no parser (mutante ">= MAX" sobrevivia), do dia com zero a esquerda/3 digitos ("007" virava 7 com \d+) e do resultRef do evento (guardava o nome em vez do id sem nenhum teste falhar). Teste novo em card-write.spec.ts e card-write.service.spec.ts (3 mutantes agora mortos).
2. Observacao (produto): "criar cartao Nubank dia 10" (sem "fecha") cria rascunho com o NOME "Nubank dia 10" e pergunta o fechamento. O nome aparece na pergunta e no resumo, da para cancelar; nada grava sem confirmar. Decisao do dono: aceitar assim, ou recusar nome terminado em "dia N"?
3. Observacao (produto, herdada da 9b-2): leitura por nome nao aceita nome com digito ("cartao c7", "cartao nubank1" caem na leitura do cartao PADRAO, com texto "Nao ha limite..." que confunde). Escrita e renomear ("renomear cartao raced4 para X") e lancamento funcionam com nome com digito. Como criar cartao pela conversa agora permite "Visa 2", o caso fica mais facil de bater. O matcher descarta de proposito frase com digito (valor na frase). Ligado as duvidas 5/7 anteriores.
4. Observacao (pre-existente, ja registrada na revisao 9b-2/3, achado 3): falha NO commit (constraint trigger deferrable) o Prisma 5.22 devolve sucesso sem persistir; a conversa diz "Cartao criado" e o banco fica com 0 linhas (reproduzido). O ramo "resultado desconhecido" so existe em teste unitario.
5. Observacao: a API POST /credit-cards aceita nomes que so diferem no acento ("Zeta" e "Zéta"), e dois nomes sem letras ("!!!", "???") passam no chat (chave normalizada vazia nao conta). A conversa barra o que da para barrar (rascunho e confirmacao). Nao e da 9b-3b.
6. Limitacao aceita, confirmada: nome com "fecha/vence" ("Vence Bem", "Fecha") recusa.

## Verificacoes reais (rv9e-pg:15561 Postgres 16, rv9e-redis:16561 Redis 7, backend nest build em 13261, Bot API falsa 13271; banco novo com 32 migrations; contas A, B, C)
- Ponta a ponta A: "criar cartao Nubank" -> pergunta do fechamento; respostas "40", "0", "abc" repetem a pergunta sem sair do rascunho; "-3" vira lembrete do rascunho; "dia 10" -> resumo (Fechamento dia 10, sem vencimento, Padrao nao) -> confirmar: banco com closingDay 10, dueDay null, isDefault false, countAllPayments false; recibo "Cartao Nubank criado, fecha dia 10." com data.cardId; evento COMPLETED com resultRef = id do cartao.
- Direto: "criar cartao Inter fecha dia 10 vence dia 17" -> 10/17 gravados. Formas "novo/cadastrar/adicionar", "fechamento 5", "fecha 1 vence 31", "fechamento dia 31", vence na frase e fechamento perguntado (31) ok. Recusas sem rascunho e sem gravar: "fecha" sem numero, dia 40, dia 0, vence 32, "fecha 10 fecha 11", vazio, 41 caracteres (40 aceito), nome so de "Fecha dia 10".
- Duplicado: "inter", "INTER", "Ínter", "Inter!", "principal", espacos extras: todos "Ja existe um cartao com este nome", 0 gravacoes.
- Cancelar: "Rascunho cancelado. Nada foi gravado." (botao e texto). Expirar (expiresAt vencido por SQL): confirmar e resposta a pergunta devolvem EXPIRED, 0 cartoes.
- Nome tomado entre rascunho e confirmacao: por API com caixa diferente (DISPUTA) e com acento ("Zéta"): "Ja existe...", nada gravado, sessao IDLE. Confirmar 3x em paralelo: 1 DONE + 2 DUPLICATE, 1 linha, 1 padrao por usuario.
- Teto 10 (C com 9 ativos, 1 vaga): APP x Telegram confirmando ao mesmo tempo, 4 rodadas: 1 grava, o outro recebe "Voce ja tem 10 cartoes ativos"; ativos sempre 10. APP x POST /credit-cards, 2 rodadas: 1 grava, 1 recusa; 10 ativos. Com 10: "criar cartao Onze" recusa sem rascunho.
- Concorrencia B (3 rodadas cada): confirmar x make-default, x PATCH rename, x DELETE (arquivar): sem 500, 0 deadlock no log, sempre 1 padrao ativo, rename concorrente deu 1 vencedor (nome tomado ou criado).
- Falha controlada (gatilho before insert): "Nao consegui criar o cartao. O rascunho foi mantido", 0 linhas, sessao AWAITING_CONFIRMATION; sem o gatilho, confirmar de novo grava (achado 4 para falha no commit).
- Integracao: novo cartao em "meus cartoes" (com fechamento/vencimento), "cartao nubank" e "limite do cartao nubank" (leitura 9b-2), lancamento "gastei 5 no cartao nubank teste" (rascunho de crédito com Nubank, 9b-1), "renomear cartao raced4 para RaceX" (9b-3). Isolamento: B e C nao veem Nubank/Paralelo/Roxo de A; A nao ve Inter de B nem Corrida1 de C ("Nao achei", lista so dos proprios); C nunca ve cartao de A nem B.
- Telegram (adapter real + Bot API falsa, vinculos A=111, B=222, C=333): rascunho, pergunta do fechamento, resposta invalida, resumo, teclado ok; TELEGRAM_WRITES_ENABLED=false: rascunho aparece, "confirmar" responde "Para gravar, confirme no app..." e o banco fica sem o cartao (0 linhas); com true confirma e grava (corridas acima). Nome "R&D <b>x" chega escapado no Telegram.

## Mutantes (21 proprios; src/conversation + src/credit-cards, 1041 testes)
Mortos 16 na 1a rodada, sobreviventes reais 3 (agora mortos), equivalentes 2.
Mortos: M2 vence sem ser palavra-chave; M3 sem "fechamento"; M5 dia 0 na frase; M6 resposta "dia 10" recusada; M7 resposta dia 32; M8 resumo sem "nao sera padrao"; M9 sempre pergunta fechamento; M10 teto 11; M11 closing/due trocados; M12 422 sem texto de teto; M13 resposta invalida sai do rascunho; M14 saveFailed invertido; M16 recibo sem vencimento; M17 "novo cartao" fora do matcher; M18 vencimento errado no resumo; M20 recheck sem normalizar.
Sobreviventes reais (cobertos): M1 borda 40 (>=), M4 \d{1,2} vira \d+ ("007"), M19 resultRef = nome. Os tres morrem com o teste novo.
Equivalentes: M15 startsWithNumericAnswer sempre true para CARD_CREATE (so e consultado fora de confirmacao, e rascunho com pendingField nulo sempre esta em confirmacao; "50 mercado" e "10" em confirmacao seguem so lembrando o rascunho, em banco real); M21 guarda "fechamento nulo" na gravacao (inalcancavel: confirmar com fechamento pendente responde 404 na API e "Ha um rascunho em andamento" no texto, 0 linhas em banco real).
Metodo: substituicao exata por ancora unica, original regravado a cada rodada; git conferido limpo apos (so os 2 specs novos modificados).

## Numeros verdes (2026-11-24, conferido por Claude Sonnet 5.5)
- npx tsc --noEmit: exit 0.
- conversation + credit-cards + transactions + telegram: 36 suites, 1169 testes verdes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo (antes: 1168; +1).
- Suite inteira (--maxWorkers=2, TZ=UTC): 90 suites, 2296 testes verdes (antes: 2295).
- graphify update .: ok (ver commit).

## NAO verificado
- WhatsApp com criar cartao (so APP e Telegram em banco real).
- Resultado desconhecido real (queda no commit): Prisma 5.22 engole a falha (achado 4); so unitario.
- Frontend (DraftView.kind sem CARD_CREATE; tela e 9c). Lint e prettier nao rodados.
- Emoji e caracteres de controle no nome; resposta do fechamento duas vezes em paralelo.
- Corrida real de duas respostas "confirmar" por canais diferentes no MESMO rascunho (so rascunhos separados por canal).

## Limpeza
rv9e-pg e rv9e-redis parados (--rm), backend e Bot API falsa encerrados, script temporario removido; portas 15561, 16561, 13261 e 13271 sem listener. detect-objects (8000) e wa-akg-db (3306) seguiram de pe; lumen-postgres-1 e lumen-redis-1 ja estavam parados antes (nao tocados). dist/ do backend foi recompilado (ignorado pelo git).

## Proximos passos
1. Dono decide as observacoes 2 e 3 (e a limitacao "fecha/vence" no nome).
2. Merge na develop (--no-ff) e atualizar o handoff.
3. Frontend 9c: CARD_CREATE e CARD_RENAME no DraftView.kind.
