# Resultado da revisao 9a-3 + merge da develop

Data: 2026-11-23. Revisor: Claude Sonnet 5.5 (sonnet), agente principal. Branch feat/varios-cartoes. Escopo: git diff 3c1bf5c..HEAD (HEAD f739584).

## Veredito
APROVADO. 0 defeitos encontrados, 0 commits de correcao. Clamp, receita sem cartao, filtro do padrao e o update() mesclado
(8a + item 9) passaram na integracao real. Sem deadlock e sem gravacao dupla em 530 rodadas concorrentes. Achados menores abaixo (nao bloqueiam).

## Achados
1. (produto, baixo) O filtro do cartao padrao (cardScopeWhere) traz tambem RECEITA com paymentMethod CREDIT e cardId nulo
   (receita CREDIT sem cartao e criavel: o 400 so vale com cardId). O gasto do ciclo nao conta receita (type EXPENSE no range),
   entao lista e ciclo divergem so nisso. Segue a decisao do dono ("filtro inclui CREDIT com cardId nulo"); pergunta ao dono: restringir a EXPENSE?
2. (teste, baixo) Mutante M18 sobreviveu: ler o lancamento com this.prisma em vez de db dentro do update() nao quebra teste unitario.
   Na pratica e equivalente em READ COMMITTED (lock da linha/User serializa; 400 rodadas reais sem violacao), mas o ideal e um teste que exija a leitura no tx.
3. (informativo) expectedUpdatedAt nao e alcancavel por HTTP (so a conversa, conversation.service.ts:1738); a concorrencia foi testada chamando o service compilado.
4. (informativo) /auth/register tem rate limit (429 apos ~4 cadastros rapidos); contas de teste da concorrencia foram criadas via Prisma.

## Verificacoes reais (Docker, nomes rv9b-pg e rv9b-redis, portas 15593/16593 e backend 13593, Postgres 16 + Redis 7)
- prisma migrate deploy em banco limpo: todas as migrations aplicadas; nest build ok; contas A, B, C registradas.
- Clamp (banco com migrations ate 20261119120000, 6 users, depois a 20261123120000): monthClosingDay 0/40/-3/31/15/1 viraram closingDay 1/31/1/31/15/1;
  creditDueDay NULL/0/45/10/NULL/1 viraram dueDay NULL/1/31/10/NULL/1; countAllPayments copiado (f,t,f,t,t,f); os 6 tetos migrados para o cartao Principal (cardId = id do cartao).
- Receita + cardId = 400 "Cartao so se aplica a despesa." em: criar (CREDIT, sem forma, PIX), editar (com/sem CREDIT), virar INCOME + cardId no mesmo corpo, conta fixa criar e editar. Parcelado nao tem type (sempre despesa; cardId ok = 201).
  Virar INCOME limpa cardId (null na resposta e na lista). Despesa CREDIT com cardId: criar 201, trocar para o padrao 200. Receita CREDIT sem cardId: 201.
- Filtro: padrao de A traz CREDIT nulo, cardId padrao explicito e (ver achado 1) receita CREDIT nula; NAO traz PIX, DEBIT, sem forma nem o do secundario. Secundario traz so o seu.
  A sem filtro: 7 dos seus, nenhum de B. A com padrao: nenhum de B. A -> cartao de B (secundario e padrao) 404; inexistente 404; C -> cartao de A 404; C lista vazia.
- Concorrencia no update() mesclado (service compilado, trigger de contagem de UPDATE, timeout 15s por chamada), N=200 por cenario, mais 30 no primeiro rodizio:
  S1 update com expectedUpdatedAt sem mexer em cartao vs makeDefault + 2 setCeiling: 200/200 ok, 0 timeout, 0 deadlock, cada lancamento com exatamente 1 UPDATE.
  S2 quatro updates do mesmo lancamento (dois com expectedUpdatedAt igual, com e sem cardId/type; dois sem expected): 0 timeout, 0 deadlock, 244 x 409 (so nos com expected), 0 gravacao dupla, descricao final = de um que deu 200.
  S3 dois updates com mesmo expectedUpdatedAt: 200 pares "200+409", exatamente 1 UPDATE por par, vencedor = valor final.
  S4 (extra) virar INCOME x trocar cartao x trocar para PIX em paralelo, 150 rodadas: 0 violacao (nunca INCOME com cardId, nunca cardId fora de CREDIT), 0 deadlock.
- Edicao por conversa (8a): src/conversation verde (dentro das suites abaixo).
- Suites do escopo (credit-cards, credit-cycle, transactions, recurring-transactions, insights, conversation, --maxWorkers=2): 1043/1043, 27 suites.
- tsc --noEmit: exit 0. Suite inteira --maxWorkers=2: 1931/1931, 73 suites (a baseline do resultado-9a3 era 1845/71: a diferenca vem do merge da develop). graphify update . ok.

## Mutantes (18 no codigo + 3 no SQL)
Codigo (rodada: suites do escopo), arquivo restaurado a cada um, git status limpo ao fim.
- Mortos (17): M01 sem FOR NO KEY UPDATE; M02 select da linha sem userId; M03 comparacao de updatedAt invertida; M04 sem 409; M05 linha ausente sem 404;
  M06 cardLock sem type; M07 cardLock sem paymentMethod; M08 expected sem transacao; M09 cardLock sem lock do User; M10 edicao INCOME+cardId nao recusa;
  M11 virar INCOME nao limpa; M12 criar nao recusa INCOME; M13 filtro padrao sem CREDIT no nulo; M14 secundario com nulos; M15 list sem userId;
  M16 conta fixa sem lock; M17 conta fixa criar sem type.
- Sobrevivente (1): M18 (leitura do lancamento fora do tx). Testado de verdade: build com a mutacao e S1-S4 com N=100: 0 violacao. Equivalente em comportamento (READ COMMITTED); lacuna so de teste unitario (achado 2).
SQL (expressao do backfill contra os usuarios reais do banco clamp), todos distintos do esperado: sem CASE (NULL vira 1), sem teto 31, sem piso 1 produzem valores errados (1,1,31,... / 40 / 0 e -3). Mortos pela conferencia real.

## NAO verificado
- Redis nao entrou em nenhum cenario com efeito (backend subiu com Redis, workers nao exercitados).
- Migration so conferida em banco novo com 6 usuarios; nao testada contra volume real nem com cartao/teto pre-existentes de outro usuario alem do Principal.
- Concorrencia com varios processos do backend (so um servico em processo + o servidor HTTP); trava e do Postgres, entao deve valer.
- TZ diferentes nao rodados nesta revisao (sem mudanca de data nesta fatia; a 9a-3 ja registrou UTC/Sao_Paulo/Tokyo 1043/1043).
- Achados 2, 4, 5 e 6 da revisao da 9a (Prisma e COMMIT, privacy-export, arquivados sem limite, Redis) seguem fora de escopo e abertos.
- Conteineres do dono (lumen-postgres-1, lumen-redis-1, wa-akg-db) seguem de pe; portas 15593/16593/13593/13594 sem listener; rv9b-* removidos; scratchpad limpo.
