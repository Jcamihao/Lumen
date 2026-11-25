# Resultado da revisao 11b-1a: compartilhar lancamentos e categorias

Data: 2026-11-25. Revisor: Claude Sonnet 5.5. Escopo: `git diff dfabe6f..HEAD` (branch feat/carteira-compartilhada-11b).

## Veredito: GO (com os 3 defeitos abaixo ja corrigidos em commits proprios)

## Achados (todos corrigidos)

1. **ALTO, vazamento de categoria do parceiro.** O parceiro podia pôr a propria categoria (privada ou compartilhada) num lancamento do autor. O autor passava a ler id, userId e monthlyBudget dela em GET /transactions (escopo mine), /dashboard/summary e na exportacao. Reproduzido por HTTP. Correcao: o parceiro so escolhe categoria criada pelo autor e compartilhada (`assertCategoryOfAuthorVisible`). Commit 34e7d0f.
2. **ALTO, `{"shared":"false"}` compartilhava.** O ValidationPipe global usa conversao implicita: a string "false" virava true no PATCH /sharing. Reproduzido por HTTP. Correcao: `@Transform(({ obj }) => obj.shared)` mais `@IsBoolean`; so booleano real passa. Commit 6f00cf8.
3. **MEDIO, 500 em corrida.** Marcar, editar ou excluir o proprio item enquanto outra requisicao o exclui dava P2025 (500). 15 respostas 500 em 30 rodadas. Correcao: P2025 vira 404 em lancamentos e categorias. Commit 406643f.

Sem defeito em: isolamento entre contas (C, D e E nunca veem nada de A e B), 404 igual a inexistente, primeiro nome, anulacao na saida e na remocao, queda e retorno do plano, exclusao de conta, exportacao, outros endpoints.

## Verificacoes reais (Docker, Postgres 16 e Redis 7 descartaveis rv11-pg e rv11-redis, portas 45431 e 46391, app na 33011)

- Migration em banco limpo: `migrate deploy` aplicou tudo; `migrate diff` vazio.
- Migration em banco populado (todas as migrations ate 20261124150000, 2 usuarios, 2 categorias, 3 lancamentos, grupo, assinatura): SQL da nova aplicada; 3 de 3 lancamentos e 2 de 2 categorias com sharedGroupOwnerId nulo; contagens iguais; `migrate diff` vazio.
- HTTP, 5 contas (A pagador, B membro, C pagador de outro grupo, D FREE, E ex-membro FREE): 5 roteiros com 98, 17, 43, 8 e 16 verificacoes, mais 7 na exclusao de conta, todas verdes apos as correcoes. Cobriu: marcar e desmarcar (so autor; 409 sem grupo, com code), scope mine, shared e all em transactions e finance-categories, escopo invalido 400, mass assignment 400, parceiro edita e apaga (autor intacto, 403 nos campos restritos, categoria 404), parceiro nao ve nada nao marcado, C, D e E sem nenhum campo ou id de A e B, 404 igual ao inexistente, so primeiro nome (sem e-mail, telefone ou userId), categoria privada so nome e cor, B nao muda o sharing de A, dashboard sem item do parceiro (A e B), queda do plano por EXPIRED e por CANCELED vencido (pausa para os dois, volta ao reativar, marcar da 409, desmarcar continua), saida, remocao e troca de grupo (itens voltam privados), exclusao da conta de A (itens somem, marca de B anulada), exportacao com shared e sem sharedGroupOwnerId.
- Outros endpoints (A e B): insights, forecasts, imports, installments, recurring, credit-cycle, credit-cards, envelopes, goals, conversation, billing, users/me e privacy-export: nenhum item, id ou sharedGroupOwnerId do outro. Bot: gravacao fica pessoal, resumo so do proprio usuario.
- Concorrencia: 90 rodadas de lancamentos depois da correcao (marcar x desmarcar x sair x remover x editar pelo parceiro x excluir pelo autor, 5 a 6 requisicoes em paralelo por rodada), mais cerca de 120 antes de o limite de taxa interferir: 0 respostas 5xx, 0 deadlock no log, 0 item visivel a ex-membro, 0 gravacao dupla. 60 rodadas de categorias: 0 5xx. Estados finais: 200, 201, 403, 404, 409.
- Falha controlada: `docker pause rv11-pg`. (a) Pausa de 5 s e de 14 s antes das requisicoes: as requisicoes esperam e terminam 200, sem estado quebrado. (b) Pausa de 9 s no meio de 24 requisicoes: 23 respostas 500 (erro generico) e 1 resposta 200; depois de unpause o app recupera, sem item compartilhado de ex-membro, marcar volta a funcionar.

## Mutantes (31 mutacoes proprias)

- Mortos na primeira rodada (19): M1 plano do leitor; M6 grupo do item; M7 autor ativo; M8 shared sem filtro; M9 setSharing sem autor; M10 setSharing sem grupo; M12 parceiro sem lock do autor; M13 lockReachable sem reconferir; M14 saida sem anular lancamentos; M16 primeiro nome inteiro; M17 categoria inteira na visao do parceiro; M18 parceiro apaga categoria; M19 parceiro troca cartao; M20 leave sem anular; M21 marca interna na resposta; M22 categoria do parceiro aceita; M23 removeMember sem anular; M24 aceite sem anular; M25 sem checar categoria.
- Sobreviventes reais, cobertos e mortos depois: M3 (membros ativos sem leftAt), M4 (membership do leitor sem leftAt; ex-membro com plano proprio leria o grupo antigo), M15 (saida sem anular categorias), M26 (findReachable de categoria sem canSeeItem; excluir categoria alheia daria 403 em vez de 404).
- Equivalentes (3): M2 (plano do autor ignorado: todo membro ativo tem o plano do pagador, e o plano do leitor ja e conferido); M5 (item privado de outro: o teste de grupo e de membro ja o recusa); M11 (findReachable de lancamento sem canSeeItem: lockReachable reconfere sob o lock e devolve o mesmo 404). Mantidos como defesa em profundidade.
- Mais: (a) remover o Transform do DTO mata 5 testes; (b) em `assertCategoryOfAuthorVisible`, trocar so o escopo para 'all' sobrevive porque a condicao do autor tambem barra (camadas redundantes, equivalente); (c) remover o mapeamento de P2025 mata o teste novo.
- Sobreviventes sem cobertura: nenhum.

## Numeros verdes (2026-11-25, conferido pelo revisor Claude Sonnet 5.5)

- `tsc --noEmit`: sem erro.
- Jest inteiro, `--maxWorkers=2`: 94 suites e 2412 testes verdes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo.

## Commits desta revisao

6f00cf8 (DTO shared), 34e7d0f (categoria do parceiro), 406643f (P2025 vira 404), e o commit de testes dos sobreviventes.

## NAO verificado

- Webhook falso do Asaas: o plano caiu por UPDATE direto em Subscription (EXPIRED e CANCELED vencido), nao por webhook, porque o tratamento do webhook consulta o Asaas. Concessao de admin tambem nao usada; assinaturas criadas por INSERT com source GRANT.
- Migration populada: a nova migration foi aplicada por psql, nao por `migrate deploy` (sem a tabela _prisma_migrations no banco montado a mao). O SQL e o mesmo; o `migrate deploy` em banco limpo passou.
- Servidor de pe apontando para o banco populado (so SQL).
- Limite de taxa: a criacao de lancamentos devolve 429 apos cerca de 240 em pouco tempo (comportamento existente); a concorrencia foi dividida em lotes.
- Pausa do banco no meio de uma transacao: os 500 sao genericos; nao foi inspecionado se alguma transacao ficou aberta no Postgres alem do fim do teste (o teste seguinte voltou ao normal).
- Plano lido fora da transacao (limitacao aceita da 11b-1a): queda de plano no meio de uma escrita so pausa na leitura seguinte.
- Testes intermitentes 15 ou 30 rodadas da suite: nao rodados (so a concorrencia por HTTP).
- Lint e prettier: nao rodados. Front e bot de gravacao compartilhada ficam para 11b-2 e 11b-3.
- Duvidas de produto da 11b-1a (duvidas.md) seguem abertas para o dono, em especial: item 7 (categoria descompartilhada continua como nome e cor no lancamento compartilhado) e a nova regra acima (parceiro so usa categoria compartilhada do autor, nunca a propria).

## Limpeza

Containers rv11-pg e rv11-redis removidos (--rm no stop); portas 45431, 46391 e 33011 sem listener; scripts de /tmp do revisor removidos; os containers de outros projetos seguem como estavam (todos parados: orquestrador-ia-*, detect-objects, wa-akg-db, lumen-postgres-1, lumen-redis-1).
