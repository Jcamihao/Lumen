# Resultado da revisão e correção: item 3b2a

Data: 2026-11-15 (relógio da sessão: 2026-11-16 UTC). Revisor: subagente sonnet. Escopo: backend e frontend do 3b2a (criar reserva e definir limite do cartão por conversa). Nenhum commit, push, amend, reset, deploy, migration, alteração de `.env`, `environment*.ts`, `package.json` ou `package-lock.json`. O grafo não foi rodado (fica com o agente principal).

## 1. Achados

Nenhum achado crítico ou alto. Os pontos abaixo são o que a revisão encontrou, em ordem de severidade.

### Médio (corrigido)

- `backend/src/conversation/conversation.service.ts:569` (antes da correção): `CreditCycleService.getCurrent` ao abrir o rascunho do limite, se falhasse, subia como 500 sem evento. Corrigido: agora responde `ERROR`/`IDLE` com `REPLIES.consultError`, grava evento `ERROR` (intent `set_credit_limit`) e loga somente `Leitura falhou: intent=set_credit_limit erro=<error.name>`. Cobre corpo com valor e corpo vazio. Nenhum rascunho nasce.

### Baixo (corrigido)

- `backend/src/conversation/conversation.service.ts:1977`: no confirmar da reserva, nome repetido por corrida com a tela (P2002 do Postgres, 400 do domínio) virava o texto genérico "Confira o nome e tente novamente". O contrato (seção 6) pede mensagem conhecida de duplicidade. Corrigido: a mensagem de duplicidade do domínio, idêntica a `REPLIES.envelopeNameTaken`, passa; qualquer outro 4xx continua genérico e a mensagem do domínio nunca vaza (teste prova os dois lados).

### Baixo (não corrigido, decisão do principal)

- `backend/src/credit-cycle/credit-cycle.service.ts:111`: o bloqueio é `FOR UPDATE`. Funciona (tabela `"User"`, coluna `"id"` confirmadas no Postgres 16 real) e não deu deadlock (ver seção 4). Efeito colateral medido: `FOR UPDATE` conflita com `FOR KEY SHARE`, então qualquer insert de filho do mesmo usuário (sessão/evento de conversa, lançamento) espera a transação do teto terminar (milissegundos). `FOR NO KEY UPDATE` tem o mesmo nível de um `UPDATE` comum de campos do `User`, serializa os escritores do teto do mesmo jeito e não bloqueia inserts de filhos. Recomendação: trocar, se o dono aceitar; é uma linha mais o teste de string em `credit-cycle.service.spec.ts` ("escopo do dono"). Não troquei porque o brief e o ponto 1 do principal pedem `FOR UPDATE` explicitamente.
- `backend/src/envelopes/envelopes.service.ts:40`: `create` da tela também passou a engolir falha de `touchUserData` depois de gravar (devolve 201). Isso não estava na lista A a D do duvidas.md (só `setCeiling` estava). Comportamento coerente com D, mas é uma quinta mudança de comportamento HTTP. Registrar no handoff.
- `frontend/.../assistant-page.component.html:101`: a etiqueta do cartão de resposta mostra "Lançado" também para reserva criada e limite definido (não são lançamentos). Texto de UX, sem impacto de dado. Arquivo html está fora da lista autorizada sem necessidade concreta; só relato.
- `frontend/.../assistant-page.component.html:109`: o lead "Confira os dados antes de confirmar." substitui o `text` do motor em `CONFIRM_DRAFT`. O motivo da revisão (mês/ciclo/teto mudou) aparece apenas como linha "Atenção" em `rows`, sem destaque visual (mesmo peso das outras linhas). Visível e correto (ver seção 5), mas pouco chamativo. Sugestão futura de produto: dar destaque à linha "Atenção".
- Limite conhecido de produto, já declarado no contrato: commit de resultado desconhecido não tem recuperação automática. Na injeção real, após `ERROR`/`IDLE` o usuário só vê aviso; se o commit tinha acontecido de fato (ack perdido), o banco tem a linha, e se o rollback foi real, não tem. O bot não distingue. Orientação "confira a tela de Finanças" é o único recurso. Não promete exatamente uma vez.

### Pontos extras do principal: veredito

1. Mudanças HTTP A a D: formato das respostas das telas não regrediu. Ver seção 4.
2. Leitura do ciclo ao abrir: corrigida e testada. Ver Correções.
3. Motivo da revisão visível: confirmado no Chrome real (claro/escuro, 390 e 1280 px), após recarregar e em `GET /conversation/session` (teste de backend novo e checagem real). Ver seções 4 e 5.
4. Os 14 mutantes obrigatórios foram refeitos por mim, cada um sozinho. Ver seção 3.

## 2. Correções feitas

Arquivos que alterei (todos dentro do escopo autorizado):

- `backend/src/conversation/conversation.service.ts`: try/catch de `getCurrent` em `startCreditLimitDraft`; texto de duplicidade em `discardText`.
- `backend/src/conversation/conversation.service.spec.ts`: 7 testes novos (leitura do ciclo falha, 2 casos; GET /session após revisão da reserva e do limite, 3 casos; `refreshPending` do limite; nome repetido por corrida) e ajuste do teste 4xx existente para não depender da mensagem de duplicidade.
- `backend/src/envelopes/envelopes.service.spec.ts`: 3 testes novos (cliente da transação, rollback da provisão, recibo sem agregação posterior).
- `backend/src/credit-cycle/credit-cycle.service.spec.ts`: 4 testes novos (escopo do dono incluindo o SQL do bloqueio, só início do ciclo, só fim do ciclo, recibo sem leitura posterior).

Nenhuma outra alteração em código de produção. Total: 14 testes novos no backend (1042 para 1056 na suíte completa).

## 3. Mutantes (cada um aplicado sozinho, desfeito antes do próximo, morte por asserção)

Execução: `python3` aplicando substituição exata, `npx jest src/conversation src/envelopes src/credit-cycle`, restaurando a cópia original depois. Todos compilaram (nenhum "morto por compilação"). Resultado final após os testes novos: 100% mortos. "Sobreviveu antes" significa que os testes do haiku não pegavam; o teste novo está indicado.

| # | Variante | Alvo | Resultado inicial | Teste que mata |
|---|---|---|---|---|
| 1 | outro `userId` no `envelope.create` | domínio | morto | `create cria o envelope e já gera o depósito` |
| 1 | outro `userId` em `createForConversation` | motor | morto | `confirmar grava com o recibo` e outro |
| 2 | outro `userId` ao ler o teto | domínio | sobreviveu | novo: `escopo do dono: bloqueio, leitura do usuário, leitura e escrita do teto` |
| 2 | outro `userId` no `upsert.where` | domínio | morto | `grava o teto do ciclo aberto agora` |
| 2 | outro `userId` no `upsert.create` | domínio | sobreviveu | mesmo teste novo |
| 2 | bloqueio sem filtro do dono (`FROM "User" FOR UPDATE`) | domínio | sobreviveu | mesmo teste novo (confere SQL e parâmetro) |
| 2 | leitura do usuário com outro id | domínio | sobreviveu | mesmo teste novo |
| 2 | outro `userId` em `setCeilingForConversation` | motor | morto | `reserva e teto são sempre do dono autenticado` e 2 |
| 3 | provisão fora da transação | domínio | sobreviveu | novos: `envelope e provisão usam o cliente da transação` e `falha na provisão inicial descarta o envelope junto` |
| 3 | envelope fora da transação | domínio | sobreviveu | mesmos dois testes novos |
| 4 | efeito auxiliar da reserva relança erro | domínio | morto | `falha ao atualizar dados derivados não desfaz a reserva` |
| 4 | efeito auxiliar do limite relança erro | domínio | morto | `... não desfaz o teto` |
| 4 | motor trata `refreshPending` da reserva como falha | motor | morto | `confirmação com refreshPending acrescenta o aviso` |
| 4 | motor trata `refreshPending` do limite como falha | motor | sobreviveu | novo: `confirmação com refreshPending acrescenta o aviso, sem virar erro nem restaurar` (limite) |
| 5 | libera `appliedKey` em commit desconhecido | motor | morto | `resultado de commit desconhecido: sem restaurar, sem liberar a chave...` |
| 5 | restaura sessão em commit desconhecido | motor | morto | mesmo teste e o do limite |
| 6 | sem comparar início do ciclo | domínio | sobreviveu | novo: `só o início do ciclo mudou: não grava` |
| 6 | sem comparar fim do ciclo | domínio | sobreviveu | novo: `só o fim do ciclo mudou: não grava` |
| 7 | sem comparar teto observado | domínio | morto | `teto vigente mudou (tela gravou antes): não grava` |
| 8 | sem comparar `countAllPayments` | domínio | morto | `opção de todas as formas mudou na tela: não grava` |
| 9 | ignora mudança de mês UTC | domínio | morto | `mês mudou desde a exibição: recusa sem criar nada` |
| 10 | versão não incrementa na revisão | motor | morto (5 testes) | `mês da provisão mudou...`, `depois da revisão, a versão antiga não confirma...` e outros |
| 11a | confirmar sem exigir `AWAITING_CONFIRMATION` | motor | morto | `rascunho sem valor não pode ser confirmado por botão nem por texto` (e o de meta) |
| 11b | sem reivindicação exclusiva (`claim.count`) | motor | morto | `rascunho editado entre a leitura e a reivindicação não é aplicado` |
| 11c | sem `appliedKey` | motor | morto (5 testes) | `evento da confirmação leva appliedKey sessão:versão...` e `chave aplicada já existente bloqueia nova gravação` |
| 12a | sem checagem do plano ao abrir | motor | morto | `plano sem vaga: recusa ao abrir, sem rascunho` |
| 12b | sem checagem do plano ao confirmar | domínio | morto (3 testes) | `create checa o limite ANTES de gravar` e outros |
| 13 | recibo da reserva depende de agregação posterior | domínio | sobreviveu | novo: `o recibo não depende de agregação posterior` |
| 13 | recibo do limite depende de leitura posterior | domínio | sobreviveu | novo: `o recibo não depende de leitura posterior` |
| 14 | motor regrava no ciclo novo após `CreditLimitChangedError` | motor | morto | `ciclo mudou antes da confirmação: nenhuma gravação no novo ciclo` e `GET /session ...` |
| 14 | domínio ignora o aceite e grava no ciclo recalculado | domínio | morto (3 testes) | `ciclo mudou`, `teto vigente mudou`, `opção ... mudou` |
| extra | duplicidade vira texto genérico; todo 4xx vira "nome repetido" | motor | morto | `nome repetido por corrida com a tela...` e `erro 4xx do serviço descarta... orientação segura` |
| extra | leitura do ciclo sem tratamento; sem evento ERROR; log com a mensagem do erro | motor | morto | `leitura do ciclo falha ao abrir...` e `... corpo vazio` |

Depois do último mutante, comparei `conversation.service.ts`, `envelopes.service.ts` e `credit-cycle.service.ts` com as cópias de trabalho: sem diferença. Busca por resíduos (`'outro'`, `false as boolean`, `false &&`) sem resultado. Sem resquício de mutante no diff.

## 4. Verificações e integração real

Infraestrutura (nada compartilhado foi tocado): contêineres próprios `lumen-3b2a-rev-pg` (postgres:16-alpine, porta 127.0.0.1:55459, banco `lumen_3b2a_review`) e `lumen-3b2a-rev-redis` (redis:7-alpine, 56409), criados por `docker run --rm` (não usei o compose para não reaproveitar o volume do banco antigo com deriva). `prisma migrate deploy` contra esse banco: todas as migrations aplicadas; `prisma migrate diff --from-url ... --to-schema-datamodel` respondeu "No difference detected" (saída 0). `DATABASE_URL` só no ambiente do processo. A porta 55439 (Bora), 5432/6379 (Agilis) e 3001 nunca foram usadas. Backend do Lumen em 3999 (billing habilitado só aí, `ASAAS_API_KEY` fictícia, sem checkout; envio de e-mail e IA externa desligados por variável de ambiente do processo), front estático em 4399 a partir de uma cópia de `frontend/dist/frontend` no scratchpad, com `app-config.js` apontando para 3999 (o repositório não foi alterado). Scripts, bootstrap de falhas e relógio simulado estão em `/tmp/claude-1001/-home-caminhao-coding/bd9c9413-cf71-4265-8b29-e861b90c2685/scratchpad/integ/` (`boot.js`, `scn1.js` a `scn5.js`, `dl.js`) e `.../scratchpad/pp/` (`ui.js`, `ui2.js`).

O bootstrap `boot.js` envolve `$transaction` do `PrismaService` do processo de teste para injetar: falha da provisão dentro da transação real, ack de commit perdido (commit real aconteceu e depois lança erro), rollback real depois do callback (resultado classificado como desconhecido), e `touchUserData` falhando. O relógio é simulado só nesse processo (offset lido de arquivo). Não mexi no relógio do sistema.

Roteiro (resultado):

| # | Passo | Resultado |
|---|---|---|
| 1 | Contas sintéticas, plano Grátis, billing só no teste | passou (cada cenário usa contas novas `rev3b2a.*@example.test`) |
| 2 | Reserva no chat, confirmação em paralelo (4 botões + "confirmar" + "sim") | passou: exatamente 1 `DONE`, 1 envelope, 1 provisão, 0 lançamentos/transferências; `DONE` traz `envelopeId` e `resultRef` = id; tela `/envelopes` mostra disponível 400; segunda reserva ativa recusada com a mensagem do plano; conta B recebe 404 ao confirmar e cancelar rascunho de outra conta, vê IDLE e nenhuma reserva, e o rascunho da dona fica intacto |
| 3 | Falha da provisão inicial dentro de transação real | passou: `ERROR` com rascunho restaurado (mesmo `draftId` e versão), 0 envelope e 0 provisão no banco, nova confirmação grava 1 envelope e 1 provisão, terceira confirmação 404 sem duplicar |
| 4 | Falha de efeito auxiliar após commit (`touchUserData`) | passou: reserva e limite com `DONE` mais aviso "Cadastro salvo. A atualização dos dados está pendente...", cadastro persistido, `data` só com `envelopeId` (limite com `data: {}`), sessão IDLE, reenvio 404, sem saldo inventado |
| 5 | Limite: tela e linha do ciclo do dono; teto mexido pela tela entre rascunho e confirmação | passou: linha única do dono com `closingDate` 2026-12-05 e 5000,00; `/credit-cycle/current` mostra 5000; teto alterado pela tela para 4200 antes de confirmar: bot devolve `CONFIRM_DRAFT` v2 com "Atenção", teto NÃO sobrescrito, v1 dá 404, v2 confirma e grava 3000; mudar a opção "todas as formas" também exige nova confirmação (aviso extra aparece) |
| 6 | Relógio simulado: mês UTC, ciclo, fusos | passou: virada de mês UTC entre rascunho (30/11 23:58Z) e confirmação (01/12 00:01Z) gera revisão v2 "12/2026 (UTC)" sem gravar, v1 dá 404 e v2 grava a provisão em 2026-12-01; Tóquio (local já dezembro) mantém novembro UTC sem revisão; São Paulo (local ainda novembro, UTC dezembro) segue dezembro UTC; virada de ciclo (São Paulo e Tóquio, fechamento dia 5) entre rascunho e confirmação gera revisão v2 com ciclo 06/12/2026 a 05/01/2027, nenhuma linha de teto gravada, v1 dá 404 e v2 grava só em 2027-01-05, nada em 2026-12-05 |
| 7 | Falha controlada de confirmação de commit (4 modos: ack perdido e rollback real, para reserva e limite) | passou: `ERROR`/`IDLE` sem `draft` e sem `quickReplies`; banco reflete o resultado real (1 linha no ack perdido, 0 no rollback); sessão IDLE; reconfirmar mesma versão 404; evento mantém `appliedKey`; "confirmar" por texto não regrava. Limite declarado: o bot não distingue os dois casos |
| 8 | Chrome real: claro/escuro, 390 e 1280 px | passou, ver seção 5 |
| extra | P2002 (nome duplicado) em transação real | passou: tela 400 com mensagem amigável, bot descarta com a mensagem conhecida; sem envelope ou provisão órfãos |
| extra | Formato das respostas HTTP das telas | passou: `POST /envelopes` tem as mesmas chaves de `GET /envelopes` (`available,color,deposited,icon,id,isActive,monthlyAmount,name,spent`); `PUT /credit-cycle/ceiling` tem as mesmas chaves de `GET /credit-cycle/current` (`ceiling,closingDay,countAllPayments,cycleEnd,cycleStart,dueDay,percentUsed,previousCeiling,remaining,spent,status`); reserva criada pela tela já nasce com depósito (deposited 90 = available 90) |
| extra | Mudanças A a D | A: nome " a " (1 caractere aparado) agora 400 com mensagem do domínio, teto 0 retorna 400. B: provisão inicial na mesma transação, confirmada acima. C: `touchUserData` falhando devolve 201 (`POST /envelopes`) e 200 (`PUT /credit-cycle/ceiling`). D: `FOR UPDATE` funciona no Postgres real |
| extra | `FOR UPDATE` no Postgres real | passou: sintaxe e nomes (`"User"`, `"id"`) válidos. Outra transação segurando o bloqueio da linha do dono faz a tela (PUT) e o bot (confirmar) esperarem (~1,5 s), e ambos concluem sem erro ao liberar. Carga mista concorrente (36 PUT do teto, 36 PATCH `/users/me`, 36 POST `/transactions`, 36 aberturas/confirmações do bot, mesmo usuário): zero 5xx, zero ocorrências de `deadlock`/`40P01` no log, uma só linha de teto. Teste SQL de transação que insere filho e depois atualiza o `User` contra um escritor `FOR UPDATE` e contra `FOR NO KEY UPDATE`: sem deadlock nos dois |

Comandos de verificação (saída resumida):

- `npx tsc --noEmit` (backend): sem erros.
- `npx jest` (backend, completo): 46 suites, 1056 testes verdes (antes 1042).
- `npx jest src/conversation src/envelopes src/credit-cycle` em `TZ=UTC`, `America/Sao_Paulo` e `Asia/Tokyo`: 11 suites, 493 testes verdes em cada.
- `npx nest build`: ok.
- `npx ng test --watch=false --browsers=ChromeHeadlessCI` (frontend): 259 de 259. Não alterei o frontend; o resultado confirma a execução do principal.
- Frontend `npm run build`: não rerodei (o `dist` é posterior a todos os fontes e nada foi alterado no frontend); vale o resultado do principal.
- Lint: o backend não tem configuração do ESLint (o script `lint` aponta para arquivo inexistente, já registrado em duvidas.md); sem comparação possível, dívida existente.

## 5. Capturas e Chrome (abertas e julgadas)

Diretório: `/tmp/claude-1001/-home-caminhao-coding/bd9c9413-cf71-4265-8b29-e861b90c2685/scratchpad/caps/`. Relatório automático das checagens (80 verificações, todas OK, nenhum erro de console ou `pageerror`): `.../caps/ui-report.txt` e `.../scratchpad/pp/ui-all.out`.

Por combinação (`light-390`, `dark-390`, `light-1280`, `dark-1280`), arquivos `<combo>-N-*.png`: `1-reserva-coleta`, `2-reserva-coleta-reload`, `3-reserva-confirmar`, `4-reserva-confirmar-reload`, `5-foco-confirmar`, `6-reserva-done`, `7-limite-confirmar`, `8-limite-revisao`, `9-limite-revisao-reload`, `10-limite-done`. Mais `light-390-11-commit-desconhecido.png`. Por exemplo: `.../caps/dark-390-8-limite-revisao.png`, `.../caps/light-1280-8-limite-revisao.png`, `.../caps/dark-1280-9-limite-revisao-reload.png`, `.../caps/light-390-5-foco-confirmar.png`.

Julgamento:

- Coleta com restauração depois de recarregar: "Falta informar: nome." visível, linha "Nome: a informar", nenhum botão Confirmar. Certo.
- Cartão da reserva: título "Reserva", Nome, Valor mensal, Início "11/2026 (UTC)", Aviso completo sobre provisão, sem `null`/`undefined`. Certo em claro e escuro.
- Cartão do limite: Ciclo, Limite atual, Novo limite, Aviso de validade por ciclo.
- Revisão: com o teto mudado pela tela, o cartão mostra "Limite atual R$ 4.200,00" e a linha "Atenção: O ciclo ou o limite atual mudou. Confira os dados atualizados e confirme novamente." O lead fixo continua "Confira os dados antes de confirmar.". O motivo continua visível depois de recarregar a página (captura `9-...`) e em `GET /conversation/session` (teste de backend e checagem real). Legível e correto, mas sem destaque visual.
- Overflow horizontal: nenhum nos quatro cenários (`scrollWidth` igual ao viewport, região sem overflow).
- Toque: botões Confirmar e Cancelar com altura de 44 px (297 px de largura em 390; maiores em 1280).
- Foco e Enter: indicador sólido de 2 px (`rgb(0,108,210)` no claro; anel azul no escuro) visível ao chegar em Confirmar por Shift+Tab, e Enter nesse botão grava (`DONE` "Reserva criada: gasolina, R$ 400,00 por mês." com etiqueta "Lançado"). Observação: `Enter` dentro do textarea do Selah insere quebra de linha (comportamento anterior do 3b1, não alterado); o envio é pelo botão "Enviar pergunta".
- Limite `DONE`: "Limite de R$ 5.000,00 definido para o ciclo com fechamento em 05/12/2026." Tela do cartão (API) mostra 5000.
- Commit desconhecido na UI real: etiqueta "Erro", texto "Não foi possível confirmar o resultado. Confira a tela de Finanças antes de enviar o pedido novamente.", sem botões de confirmar/cancelar, e depois de recarregar não reaparece Confirmar.

## 6. Pendências e o que não foi verificado

- Frontend `npm run build` e lint não foram rerodados por mim. `ng test` sim (259 verdes).
- Não testei WhatsApp (fora do escopo do 3b2).
- Não testei o fluxo de checkout (desligado de propósito).
- Não verifiquei a atualização assíncrona (fila/pulso) que `touchUserData` dispara; só simulei a falha dela.
- O resultado de commit desconhecido em Postgres foi simulado por injeção no cliente Prisma do processo de teste; não derrubei a conexão nem desliguei serviços. O comportamento de um corte real de rede no meio do `COMMIT` não foi exercido.
- Troca do bloqueio para `FOR NO KEY UPDATE` fica para decisão do principal ou do dono (seção 1).
- `Lançado` na etiqueta de reserva/limite e o realce da linha "Atenção" ficam como melhorias de UX.
- Handoff e grafo ficam com o principal.

## 7. Limpeza

Feita e conferida: contêineres `lumen-3b2a-rev-pg` e `lumen-3b2a-rev-redis` parados (`--rm`, removidos junto com o banco descartável, as contas sintéticas e as chaves de cache); backend 3999 e estático 4399 parados; nenhuma porta própria em escuta; Postgres 55439, 5432 e 6379 (outros projetos) intocados. `git status` só com mudanças do escopo (os `??` de `.superpowers/sdd/conversa-item-2b/*.log` já existiam antes da revisão). Sem diff em `.env`, `environment*.ts`, `package.json` ou `package-lock.json`. Nenhum token em arquivo do repositório. O `backend/dist` foi regenerado por `nest build` (ignorado pelo git). Scripts e capturas ficam só no scratchpad da sessão.
