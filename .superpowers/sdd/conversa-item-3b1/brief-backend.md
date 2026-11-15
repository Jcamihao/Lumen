# Brief: Finanças por conversa, item 3b1 (metas e aportes), BACKEND

Para: subagente de desenvolvimento (haiku). Relatório final em estilo curto, sem enfeite. Código, comentários e textos de tela em português do Brasil, prosa normal.
Projeto: `/home/caminhao/coding/codeStage/Lumen`. Trabalhe só em `backend/src/conversation/`. NÃO toque em `frontend/` (outro agente faz depois, lendo os tipos que você deixar), em `prisma/` nem em outros módulos.

## Objetivo

1. Corrigir "reservas": passam a ser **envelopes** (nova leitura `envelopes`); `goals` deixa de responder a "reservas".
2. Escrever metas por conversa, sempre com rascunho e confirmação: `create_goal` (criar meta) e `contribute_goal` (aporte).

## Leia antes de escrever código (nesta ordem)

1. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b1.md`: **fonte única** (frases, campos, textos, regras, testes, mutantes). Siga ao pé da letra. Dúvida ou conflito: escreva em `.superpowers/sdd/conversa-item-3b1/duvidas.md` e pare naquele ponto; não decida sozinho.
2. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-1.md` (seção 7: algoritmo de confirmação) e `...-item-3a.md`.
3. `backend/src/conversation/` inteiro como está hoje. Atenção a: `applyDraft`, `createAppliedEvent`, `restoreSession`, `fillPendingField`, `handleWithSession`, `startDraft`, `questionFor`, `toDraftView`, `draftReply`, `runRead`, `answerRead`, `matchCategory`, `isOptionNumber`, `isAmountAnswer`, `parsers/intent.matcher.ts` (`matchFinanceRead`, `missingAmount`, `FINANCE_READ_*`), `replies.ts`, `conversation.types.ts`.
4. Serviços consumidos (só leia): `backend/src/goals/goals.service.ts` (`list`, `create`, `contribute`, `serializeGoal`), `backend/src/envelopes/envelopes.service.ts` (`list`), `backend/src/billing/entitlements.service.ts` (`assertCanCreate`) e `backend/src/billing/plan-limit.exception.ts`.

## O que fazer

1. **Matcher** (`parsers/intent.matcher.ts`):
   - `envelopes` como nova leitura (frases do contrato, seção 1); remover `minhas reservas`, `reservas` e `como esta minha reserva` de `goals`. Mesma regra de palavras extras do 3a.
   - `create_goal` e `contribute_goal` como novas variantes de `IntentMatch` (com os campos que o motor precisa: corpo bruto, flags de valor/nome ausente), conforme seção 3. Comandos curtos (até 6 palavras e sem `?`). Garanta que perguntas longas e as sugestões do Selah NÃO casam.
2. **Tipos** (`conversation.types.ts`): `GoalDraft`, `ContributionDraft`, `kind` em `ExpenseOrIncomeDraft` (ausente = `TRANSACTION`), `PendingField` estendido, `DraftView` com `kind`, `title`, `rows` (campos antigos continuam preenchidos para lançamento), `ReplyData` com `goalId` e `envelopes`.
3. **Motor** (`conversation.service.ts`): despachar por `kind` do rascunho (e `session.intent`) em todos os pontos que hoje assumem lançamento: abrir rascunho, preencher campo pendente, pergunta pendente, `toDraftView`, `applyDraft`. A parte de reivindicar/`appliedKey`/restaurar NÃO muda de algoritmo; só o "aplicar" passa a ter um caso por tipo (`TransactionsService.create`, `GoalsService.create`, `GoalsService.contribute`). Regras de erro da seção 3 do contrato ("Falha ao gravar"): `PlanLimitException` e `HttpException` com status < 500 descartam o rascunho; o resto restaura como hoje.
   - Leitura `envelopes` via `EnvelopesService.list(userId)` dentro de `runRead` (herda o tratamento de erro).
   - `create_goal`: checar `EntitlementsService.assertCanCreate(userId, 'goals')` ao abrir o rascunho.
   - Busca de meta para aporte: `GoalsService.list(userId)` filtrada por `status === 'ACTIVE'`; reuse `matchCategory` mapeando `{ id, name: title }` (igualdade, depois prefixo; o contrato fala em "contém" como terceiro passo, implemente também).
4. **Textos** (`replies.ts`): templates novos (seção 3 do contrato), tom técnico, sem exclamação, valores com `formatBrl`.
5. **Módulo**: importar `EnvelopesModule` e `BillingModule` (para `EntitlementsService`); injetar `EnvelopesService` e `EntitlementsService`. Atualizar os specs que montam o serviço à mão.

## Regras que não podem quebrar

- `userId` só do argumento do motor e repassado aos serviços. Nunca do texto. O `goalId` do rascunho vem de `GoalsService.list(userId)`.
- Nenhuma escrita sem `confirmar`. Nenhuma escrita em leitura.
- Dinheiro em centavos inteiros no rascunho; reais só ao chamar o serviço.
- Não gravar texto de mensagem em evento nem em log. Log só com id da intenção e `error.name`.
- Constantes nomeadas no topo para limites (5 opções, 60 caracteres, 6 palavras).
- Nada fora de `backend/src/conversation/`.

## Testes (jest, estilo dos specs existentes; relógio travado em `T0` como o spec já faz)

Cubra a seção 7 do contrato (parte backend) inteira. Pontos que costumam escapar:

- `reservas` não casa `goals` e casa `envelopes`; `metas` continua `goals`.
- Limite do plano: recusa ao abrir E ao confirmar (limite surgindo no meio); `PlanLimitException` descarta o rascunho (não volta em loop) e mostra a mensagem dela.
- Aporte que conclui a meta: aviso no rascunho e "Meta concluída." no `DONE`.
- Meta apagada entre rascunho e confirmação: descarta com a mensagem do contrato.
- Duas confirmações em paralelo: `GoalsService.create`/`contribute` chamados uma vez.
- Isolamento A/B e os 4 mutantes do contrato (faça cada mutante à mão: aplique, veja o teste quebrar, desfaça).
- Sessão antiga sem `kind` continua funcionando como lançamento.

## Como verificar (rode e cole a saída resumida)

Dentro de `backend/`:
1. `npx jest src/conversation`
2. `npx jest` (inteiro; hoje 44 suites, 817 testes)
3. `npx nest build`
4. `npx jest src/conversation` com `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`
Na raiz, ao final: `graphify update .` (um só, nunca em paralelo).

## Proibições

- Não fazer commit, push, amend, reset nem deploy. Deixe as mudanças na árvore; o agente principal commita depois da revisão.
- Sem segredo em arquivo. Sem dependência npm nova. Não "melhorar" código fora do escopo.

## Entregue para o agente do frontend

Ao terminar, deixe em `.superpowers/sdd/conversa-item-3b1/contrato-tipos.md` o formato final e exato de `DraftView` (com 3 exemplos reais de JSON: lançamento, meta, aporte, copiados de uma execução de teste) e de `PendingField`. O agente do frontend lê esse arquivo.

## Relatório final (curto)

Arquivos criados e alterados, saída resumida dos comandos, decisões onde o contrato era omisso, dúvidas registradas, e o que você NÃO conseguiu verificar.
