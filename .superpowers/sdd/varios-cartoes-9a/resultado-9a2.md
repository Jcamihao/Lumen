# Resultado da 9a-2 (cardId em lancamento, parcelado e recorrencia; so backend)

Data: 2026-11-23. Branch: feat/varios-cartoes (base do brief: 6927b09). Implementador: agente haiku (claude-haiku-5-5).
Revisao: agente sonnet somente leitura (claude-sonnet-5-5), antes das correcoes. Conferencia independente pelo agente principal: suite, mutantes e diff relidos.

## Status
Escopo do brief entregue no backend. Sem migration nem schema (as colunas ja existiam da 9a-1). Conversation nao mudou.
Falta: teste em Postgres real (Docker desligado); ver "NAO verificado".

## Commits (branch feat/varios-cartoes)
- 1f78a06 refactor(credit-cycle): escopo de gasto do cartao num helper compartilhado com o insights (cardSpendWhere em credit-cycle.util.ts)
- 59c2811 feat(transactions): cardId em lancamento (card-link.ts, dtos, service)
- 74102c5 feat(installments): cardId em compra parcelada
- 717b583 feat(recurring-transactions): cardId em conta fixa e recorrencia
- 58c55b5 feat(materializers): parcelas e recorrencias herdam o cardId do modelo
- 02294df test(credit-cards): specs de isolamento A/B/C, escopo de gasto, materializadores e insights
- 7673856 fix(credit-cards): troca de forma de pagamento pega o lock do User; 404 se a conta fixa sumir na edicao (achados da revisao)
- f23e4e6 fix(insights): ciclo do cartao padrao usa o closingDay do proprio cartao (espelho do User so como fallback)

## O que mudou
- card-link.ts (novo): regras de vinculo (so CREDIT; cartao alheio/inexistente = 404 com a mesma mensagem; arquivado bloqueia vinculo novo; cardId ja gravado e depois arquivado segue valido na edicao; sair de CREDIT limpa cardId). Ordem de locks documentada: User (FOR NO KEY UPDATE) -> cartao -> lancamento. Lock so quando ha cardId ou troca de forma de pagamento.
- Lancamento: create/update/list aceitam cardId; leitura devolve cardId e cardName (sem objeto card). Filtro cardId na listagem (alheio = 404 antes de consultar).
- Parcelado e conta fixa: cardId no create (e na edicao da conta fixa); leitura com cardName; include com select so do nome.
- Materializadores: copiam cardId do modelo. Nao checam cartao arquivado.
- Insights: gasto do ciclo usa cardSpendWhere (mesmo filtro do CreditCycleService). Ciclo pelo closingDay do cartao padrao.
- Exportacao de dados (users.service, transactions sem select): cardId ja sai sozinho por ser coluna escalar; nenhuma mudanca.
- Swagger: ApiPropertyOptional/ApiProperty nos campos novos.

## Comandos e numeros (conferidos pelo agente principal)
- npx tsc --noEmit -p tsconfig.json: exit 0 (antes e depois).
- Dominios (transactions, installments, recurring-transactions, credit-cycle, credit-cards, insights, conversation, users), --maxWorkers=2: 28 suites, 1007 testes, verde em TZ=UTC, America/Sao_Paulo e Asia/Tokyo.
- Suite inteira, TZ=UTC, --maxWorkers=2: 69 suites, 1809 testes, verde (rodada final, apos as correcoes).
- Repeticao 15x (materializadores, card-link, credit-cycle.spend, insights), TZ alternando UTC/Sao_Paulo/Tokyo: 15 de 15 verdes, 135 testes cada.
- Mutantes: 27 injetados, arquivo restaurado a cada um (git status limpo depois). Mortos: 27. Sobreviventes: 0. Equivalentes: 0.
  - M01 sem checar CREDIT na criacao; M02 cartao sem filtro de dono; M03 arquivado aceito na criacao; M04 arquivado ja gravado bloqueado na edicao; M05 sair de CREDIT nao limpa; M06 cardId null nao limpa; M07 mensagem 404 diferente para alheio; M08 sem lock na guarda; M09 lock de cardId desligado; M10 listagem sem checar dono; M11 listagem sem filtro de cartao; M12 cardName ausente; M13 parcela nao grava cardId; M14 conta fixa nao grava cardId; M15 edicao de conta fixa ignora cardPatch; M16 parcela nao herda cardId; M17 recorrencia nao herda cardId; M18 padrao ignora cardId nulo; M19 countAll liberado em nao padrao; M20 padrao soma PIX/debito; M21 insights volta ao filtro antigo; M22 lancamento nao grava cardId; M23 edicao de lancamento ignora cardPatch; M24 cardId do filtro sem IsUUID; M25 troca de forma sem lock; M26 ciclo do insights volta ao espelho do User; M27 recorrencia sem 404 se a conta sumir.
- graphify update . (raiz): exit 0 (apos as correcoes). graphify-out fica fora do git.

## Revisao sonnet (somente leitura) e o que foi feito
- Gravidade alta: nenhuma. Isolamento, ordem de locks, herança e cardName conferidos sem problema.
- Media/baixa 1 (corrigido, 7673856): PATCH para PIX sem lock podia deixar cardId gravado por outro PATCH. Agora a troca de forma tambem pega o lock. Teste e mutante M25.
- Media/baixa 2 (corrigido, f23e4e6): insights usava o dia do User espelhado; agora o closingDay do cartao padrao, espelho so como fallback. Teste e mutante M26.
- Baixa (corrigido, 7673856): edicao de conta fixa apagada em paralelo dava 500; agora 404. Teste e mutante M27.
- Baixa (corrigido, 7673856): listagem com cardId alheio consultava materializacao antes do 404; agora o 404 vem antes.
- Baixa (aceito): lancamento INCOME com cardId CREDIT e aceito. Nao entra no gasto (so EXPENSE conta), so fica sem sentido. Restringir fica para decisao do dono.
- Revisao sonnet NAO foi repetida sobre as correcoes.

## Decisoes tomadas (registrar no handoff)
- Lock do User: pego quando a escrita traz cardId ou troca forma de pagamento (edicao). Create sem cardId nao pega lock.
- Filtro cardId da listagem e igualdade exata: o cartao padrao NAO traz os lancamentos antigos com cardId nulo. Se quiser incluir, e mudanca de regra.
- Insights sem cartao padrao ativo: gasto do ciclo = zero (antes somava CREDIT do User). Sem cartao padrao nao deveria existir (invariante da 9a-1).
- Conversation: DTO sem cardId, entao segue o fluxo antigo (cartao padrao). Specs de conversation passam sem ajuste.

## NAO verificado (e por que)
- Postgres real: Docker desligado nesta maquina. Nao rodei: FOR NO KEY UPDATE contra PG, deadlock real, corrida real entre arquivar/criar/trocar forma (so o fake de lock simulado nos specs), falha controlada no meio do commit, indices unicos parciais da 9a-1.
- Migration: nao tocada nesta etapa, mas a da 9a-1 segue sem rodar em PG 16 (pendencia da 9a-1).
- Swagger: so decorators; API nao subiu para conferir a documentacao gerada.
- Lint/prettier: nao rodados neste passo.
- Revisao sonnet sobre o codigo corrigido (7673856, f23e4e6): nao feita.
- Teste de data do insights (cardClosing) compara com new Date() do teste: so falharia se a suite cruzar a meia-noite UTC no meio da execucao. Repetido 15x sem falha.
- Concorrencia de lancamento: nao ha teste de corrida real; a leitura da linha sob lock e garantida pelo desenho, nao provada.

## Onde parou / proximo passo
- Nada de codigo pendente na 9a-2.
- Pendencias: (1) migration e concorrencia em Postgres 16 descartavel (9a-1 e 9a-2), quando Docker voltar; (2) revisao sonnet sobre as correcoes; (3) decidir se INCOME com cartao deve ser recusado; (4) decidir se o filtro de cardId deve incluir nulos no cartao padrao.
