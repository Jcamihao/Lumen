# Revisao da 9a (9a-1 + 9a-2), cartoes nomeados

Data: 2026-11-23. Revisor: Claude Sonnet 5.5 (sonnet). Branch feat/varios-cartoes, base 92fff11, HEAD da revisao 8953427.
Implementacao original: haiku. Esta revisao fez integracao real, revisao de codigo e mutantes.

## Veredito
**APROVADO COM RESSALVAS.** Isolamento A/B/C sem nenhum furo, concorrencia sem deadlock nem invariante quebrada,
migration correta em banco limpo e populado. 1 defeito real encontrado e corrigido (nome com % ou _). Restam 4 riscos/lacunas
para o dono decidir (secao Riscos), nenhum bloqueia o merge na develop.

## Commits desta revisao (sem push, sem amend/reset)
- e0db820 fix(credit-cards): nome com % ou _ nao vira curinga na checagem de nome repetido
- 8953427 test(credit-cards): testes para os mutantes sobreviventes da revisao 9a
- (este relatorio vai em commit docs proprio)

## Achados
| # | Sev. | Achado | Estado |
|---|------|--------|--------|
| 1 | Media | **409 falso por curinga.** assertNameFree usava mode insensitive, que o Prisma traduz para ILIKE: criar "A_C" com "AbC" existente, ou "%" com qualquer cartao existente, dava 409 (reproduzido na API real). O fake do spec comparava igualdade exata, entao nenhum teste via isso. | **Corrigido** (e0db820): compara em memoria os ativos do usuario (max 10); o indice parcial lower(name) segue como garantia contra corrida. Fake do spec agora emula ILIKE. Reconferido na API real. |
| 2 | Media (transversal, anterior ao item 9) | **Prisma 5.22 devolve sucesso quando o COMMIT falha no banco.** Provado com script nu, fora do repo: conexao morta durante o COMMIT e o $transaction retornou normalmente, banco sem a linha. Pela API: POST /credit-cards respondeu 201 com recibo de algo que nao persistiu (idem teto: 200). Com constraint diferida que falha no commit, igual. O caminho "resultado desconhecido" (callbackFinished) so dispara se o erro for lancado, o que o Prisma 5.22 nao faz nesses casos. | **Nao corrigido** (fora de escopo, vale para todo o backend). Hoje o schema nao tem constraint diferida; o risco real e queda de conexao exatamente no COMMIT (janela de ms). Decisao do dono: atualizar o Prisma e repetir o teste, ou reler o registro apos o commit nas escritas com recibo. |
| 3 | Baixa | Migration copia monthClosingDay/creditDueDay do User sem clamp. Dados fora de 1..31 (0, 45, -3, dueDay 99/0, so possiveis por SQL direto, pois os DTOs sempre validaram 1..31) viram cartao Principal com o mesmo valor invalido. Comportamento do ciclo igual ao de antes (creditCycleBounds com dia 0 ou negativo gera ciclo de 2 meses; 45 vira fim de mes). | Nao corrigido. Recomendo GREATEST(1, LEAST(31, x)) no backfill se algum ambiente tiver esses dados; conferir com SELECT antes de aplicar em producao. |
| 4 | Baixa (escopo) | /users/me/privacy-export nao traz cartoes (nem parcelados nem tetos, lacuna anterior). cardId dos lancamentos sai, o nome do cartao nao. | Nao corrigido: acrescentar dataset e decisao de escopo do dono (LGPD/portabilidade). |
| 5 | Baixa | Cartoes arquivados nao tem limite (so os ativos tem teto de 10): criar+arquivar em loop cresce a tabela. Limitado so pelo rate limit global (120/min). | Aceitar ou limitar total de arquivados. Decisao do dono. |
| 6 | Info | refreshPending=true nao pode ser provocado so derrubando o Redis: o CacheQueueService degrada em silencio e touchUserData nao lanca. | Verificado com bootstrap (secao 2). |

Sem achado em: isolamento (ver 2), ordem de locks (User -> cartao -> lancamento, sem deadlock), DTO sem validacao (corrigido pelos testes novos, ver mutantes), vazamento de nome de cartao ou valor em log (0 ocorrencias no log da API; logs de falha auxiliar so trazem operation e errorName), N+1 (listagens usam include com select de nome, um join; insights +1 findFirst), mudanca de contrato (so campos novos cardId e cardName; /credit-cycle/* mantem as 11 chaves).

## 1. Verificacoes reais (Postgres 16 e Redis 7 descartaveis, nest build)
Containers rv9-pg (55601), rv9-redis (55602), API em 55603, todos removidos no fim.

### Migration
- (a) Banco limpo: 31 migrations aplicadas, "All migrations have been successfully applied".
- (b) Banco populado ate 20261119120000: 5 usuarios (closing 5, 0, 45, -3, 30; dueDay 15, nulo, 99, 0, nulo; countAll variado), 4 tetos, 5 lancamentos (CREDIT, PIX, DEBIT, INCOME), 1 parcelado, 1 recorrencia. Depois da 20261123120000: contagens identicas (5/4/5/1/1), 5 cartoes Principal padrao (1 por usuario, campos copiados), 4 tetos com cardId do cartao do proprio dono, 0 lancamentos com cardId.
- (c) Reexecutar o INSERT do backfill: INSERT 0 0 (nao duplica).
- (d) prisma migrate diff (migrations x schema.prisma): "empty migration". O Prisma 5.22 nao enxerga os indices parciais, entao nao propoe dropa-los; aviso do schema segue valido.
- (e) Indices parciais: nome duplicado sem caixa recusado ("principal" x "Principal"); segundo padrao ativo recusado; arquivado libera o nome; padrao/nome de outro usuario nao conflita.

### API real, contas A, B, C
- t1 funcional: **96 de 96**. CRUD, recibo, teto tecnico 10 (11o = 422), countAllPayments so no padrao, make-default, arquivar (padrao 409, repetido idempotente), espelho nos dois sentidos (cartao->User, User->cartao, settings->cartao e User, make-default->User), /credit-cycle/* com as mesmas 11 chaves, cardId em lancamento/parcelado/recorrencia (CREDIT ok; PIX, DEBIT e sem forma = 400; alheio e inexistente = 404 com mesma mensagem; arquivado em criacao = 400; edicao de lancamento de cartao arquivado preserva), heranca em parcela e recorrencia geradas, cardName na leitura, filtro cardId (alheio/inexistente 404, nao UUID 400), ciclo: padrao conta cardId nulo (spent 100), secundario so o seu (spent 200), teto do secundario nao vaza no padrao, 6 tetos invalidos = 400.
- t2 isolamento: B e C contra recursos de A em 10 rotas novas/alteradas (GET/PATCH/DELETE :id, make-default, cycle, ceiling, POST lancamento/parcelado/recorrencia com cardId, filtro) com resposta de cartao alheio **identica byte a byte** a de inexistente (status e mensagem); PATCH de lancamento e recorrencia proprios com cartao alheio = 404; PATCH/DELETE de recurso alheio = 404; listagens sem nenhum id ou nome de A; 8 rotas sem token = 401; **estado de A intacto** (snapshot antes e depois dos ataques). Rodada final: 55 ok; as 2 falhas registradas sao do meu proprio teste (assumia spent<=1, mas o gasto vem dos lancamentos de teste do proprio B/C), sem vazamento.
- t3 concorrencia (20 em paralelo): mesmo nome = 1 grava, 19 recebem 409; 20 nomes distintos = exatamente 9 criam e 11 recebem 422 (teto 10 respeitado); 10 make-default simultaneos = 10x 201 e 1 padrao; 10 rodadas de 7 operacoes cruzadas (make-default, PUT ceiling padrao, PUT ceiling cartao, PATCH cartao, PATCH /users/me, PATCH settings, arquivar) = 0 respostas 5xx; 30 corridas troca de forma x vinculo de cartao = 0 lancamentos com cardId e forma diferente de CREDIT; 20 corridas arquivar x vincular = 0 5xx; 20 corridas PATCH cartao padrao x /users/me x settings = espelho consistente em 20 de 20. Invariantes por SQL ao fim: sem padrao 0, dois padroes 0, padrao arquivado 0, espelho quebrado 0, countAll em nao padrao 0, teto de outro dono 0, cardId de outro dono 0, usuario com mais de 10 ativos 0. Log do Postgres: 0 deadlock. Reexecutado apos a correcao (t10): mesmo nome x20 = 1 grava; teto x20 = 8+12.
- Fusos: ciclos de 3 cartoes de 2 contas identicos com a API em TZ=Asia/Tokyo, UTC e America/Sao_Paulo.

### 2. Falha controlada
- **Nao persistiu comprovado:** 409 de nome duplicado (nada gravado); falha dentro da transacao (trigger imediato) = 500 generico, sem vazar SQL, nada gravado, mensagem sem "desconhecido".
- **Persistiu:** 201 com recibo e refreshPending=false, linha confirmada no banco.
- **Desconhecido:** o servico responde 500 "resultado desconhecido, nao repita" apenas quando o erro do commit chega a ele. **Achado 2**: com falha real de commit (trigger diferido e conexao morta com pg_terminate_backend) o Prisma devolveu sucesso e o servico respondeu 201/200 sem persistir. O ramo "desconhecido" e coberto por testes unitarios (fake), nao pelo banco real.
- **Falha auxiliar pos-commit (refreshPending):** bootstrap fora do repo (dist + banco real + LifeEngine que lanca erro): create, setCeiling e make-default persistiram, devolveram refreshPending=true, o refresh foi chamado 1 vez (sem retry); duplicado deu 409 sem chamar refresh. Log so com operation e errorName.

## 3. Mutantes (27 proprios, diferentes dos 23+27 do haiku; arquivo restaurado a cada um, git status limpo)
Rodada 1 contra a suite de dominio (19 suites, 415 testes): **17 mortos, 1 equivalente, 9 sobreviventes.**
- Mortos: N01 so PIX bloqueia cartao; N02 sem atalho "mesmo cardId"; N03 forma efetiva ignora o dto; N04 teto conta arquivados; N05 make-default sem atalho no padrao; N06 arquivar padrao liberado; N09 sync User em edicao de nao padrao; N10 refreshPending invertido; N12 teto aceita 0; N13 teto maximo x10; N15 espelho de dueDay nulo; N16 secundario absorve nulos; N17 gasto soma INCOME; N22 Principal do cadastro nao padrao; N23 /users/me atualiza todos os cartoes; N25 cardId null nao limpa; N27 parcelado ignora forma de pagamento.
- Equivalente: N24 (typeof cardId === 'string' trocado por Boolean(cardId): so difere para string vazia, que o IsUUID recusa antes).
- Sobreviventes reais, todos com teste novo (8953427) e **mortos na rodada 2**: N07 arquivar repetido regrava archivedAt; N08 countAll=false recusado em secundario; N11 listagem sem padrao primeiro (o fixture tinha o padrao como cartao mais antigo); N14 teto sugerido usa lte; N18 closingDay max 40; N19 nome max 50; N20 PATCH closingDay min 0; N21 includeArchived sem IsIn (os DTOs de cartao nao tinham spec); N26 insights busca cartao sem isDefault (o mock ignorava o where).
- Mutante extra do achado 1 (voltar ao ILIKE): morto por 2 testes.
- Placar final: 26 mortos, 1 equivalente, 0 sobreviventes.

## 4. Duvidas do haiku (duvidas.md)
- **Item 1** (insights troca a chave do teto): decisao correta e exigida pela spec 4.8; a 9a-2 ja corrigiu o ciclo para o closingDay do cartao e o filtro usa cardSpendWhere. Recomendo **dar por resolvido**; teste novo garante a busca do padrao ativo do proprio usuario.
- **Item 5** (espelho User <-> padrao sem CHECK): em Postgres real o espelho nunca quebrou (20 corridas de 3 escritores + 10 rodadas de 7 operacoes + invariante SQL = 0). Todos os escritores pegam o lock do User antes. Recomendo **manter so por codigo** e nao criar CHECK de 1..31 enquanto houver dado antigo fora da faixa (achado 3); revisitar na 9c, quando o espelho sair.
- **Item 6** (concorrencia teto x promocao): **fechado em Postgres real** (10 rodadas com PUT ceiling padrao e de cartao x make-default x PATCH x arquivar, 0 5xx, 0 teto de outro dono, 0 deadlock). Recomendo **nao** pedir teste automatizado novo no repo (jest com fake nao prova lock); se quiser regressao permanente, vale um job de integracao com Postgres descartavel.
- Item 7 (HEAD destacado): nao reproduzido; branch segue anexada em feat/varios-cartoes.

## 5. Decisoes AINDA ABERTAS com o dono (nao decididas nem implementadas)
- **(a) Receita (INCOME) com cardId deve ser recusada?** Hoje: **aceita** (POST de INCOME + CREDIT + cardId = 201, cardId e cardName gravados). Nao entra em nenhum gasto de ciclo (so EXPENSE conta; confirmado: spent do cartao ficou 200, nao 250). Impacto: so poluicao, uma receita aparece na lista filtrada por cartao e com nome de cartao. Recusar exige regra nova em card-link (tipo do lancamento) e tratar a troca de tipo na edicao.
- **(b) O filtro por cardId do padrao deve incluir os antigos com cardId nulo?** Hoje: **nao** (igualdade exata). Verificado: o ciclo do padrao somou 100 de um lancamento CREDIT com cardId nulo, mas GET /transactions?cardId=<padrao> devolveu 0 itens. Impacto: a tela do cartao padrao mostra gasto no ciclo sem os lancamentos que o compoem ate o front migrar (9c) ou os antigos receberem cardId. Incluir exige OR(cardId = padrao, cardId nulo e CREDIT) so para o padrao e muda a leitura.

## 6. Numeros verdes (2026-11-23, conferidos pelo revisor sonnet)
- tsc --noEmit: sem erro.
- Dominios (credit-cards, credit-cycle, transactions, installments, recurring-transactions, insights, users, conversation), --maxWorkers=2: 29 suites, 1021 testes, verde em TZ=UTC, America/Sao_Paulo e Asia/Tokyo.
- Repeticao 15x (credit-cards, credit-cycle, insights; TZ alternando): 15 de 15 com 195 testes.
- Suite inteira, TZ=UTC, --maxWorkers=2: **70 suites, 1823 testes, verde** (antes da revisao: 69/1809; +1 suite de DTO e +14 testes).
- graphify update . : ok.
- Limpeza: rv9-pg e rv9-redis removidos (--rm), 0 containers rv9; sem listener em 55601/55602/55603; lumen-postgres-1, lumen-redis-1 e wa-akg-db continuam de pe, intocados (5433, 6380, 3306 nunca usadas); 0 processo da API; volumes anonimos do Postgres removidos junto.

## 7. NAO verificado (e por que)
- Prisma >= 5.23/6.x: nao testei se o engolimento de erro de COMMIT (achado 2) foi corrigido em versao nova.
- Swagger gerado: API subiu com APP_SWAGGER_ENABLED=false; so decorators lidos.
- Lint e prettier: nao rodados.
- Suite inteira 15x e nos 3 fusos: so os dominios nos 3 fusos e 15x os 3 modulos de cartao/ciclo/insights.
- DELETE /users/me (cascata em cartoes e tetos): FK ON DELETE CASCADE lida na migration, exclusao nao executada.
- Materializadores com cartao ja arquivado em Postgres real: heranca no create verificada; o caso "arquivou depois" so por teste unitario.
- Conteudo dos insights de credito (so status 200 e ausencia de dado de outra conta); ciclo coberto por testes de unidade.
- Escritas da API em outros fusos (so leitura de ciclo foi comparada nos 3 fusos).
- Conversation/WhatsApp com cartoes (nao alterado pela 9a; so os specs rodam).
- Carga e tempo de lock da migration em tabela grande; migration contra dados reais de producao.
- Frontend (9c).

## 8. O que falta e recomendacao
1. Dono decide (a) INCOME com cardId e (b) filtro do padrao com nulos.
2. Dono decide o achado 2 (Prisma engole falha de COMMIT): recomendo atualizar o Prisma em item proprio e repetir o teste de conexao morta; ate la, o "desconhecido" nao e confiavel no backend inteiro.
3. Dono decide achado 3 (clamp no backfill, recomendo sim) e achado 4 (cartoes na exportacao, recomendo incluir).
4. Merge de feat/varios-cartoes na develop (--no-ff) e atualizar o handoff com a 9a integrada e esta revisao. **Recomendacao: pode mergear apos as decisoes 1 a 3 que afetem a migration (clamp).** Proximo passo: 9b/9c.
