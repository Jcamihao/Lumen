# Brief: Finanças por conversa, item 3a (consultas), backend

Para: subagente de desenvolvimento (haiku). Relatório final em estilo curto, sem enfeite. Código, comentários e textos de tela em português do Brasil, prosa normal.
Projeto: `/home/caminhao/coding/codeStage/Lumen`. Trabalhe só em `backend/src/conversation/`. Não toque em `frontend/`, em `prisma/` nem em outros módulos.

## Objetivo

Acrescentar ao motor de conversa 4 consultas que não gravam nada: `upcoming_dues`, `installments`, `fixed_bills`, `goals`. E tratar falha de serviço em TODAS as leituras (hoje a exceção sobe e vira 500).

## Leia antes de escrever código (nesta ordem)

1. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3a.md`: **fonte única** das frases, regras, textos, `ReplyData` e testes. Siga ao pé da letra. Dúvida ou conflito: escreva em `.superpowers/sdd/conversa-item-3a/duvidas.md` e pare naquele ponto; não decida sozinho.
2. `backend/src/conversation/` inteiro como está hoje: `parsers/intent.matcher.ts` (+spec), `conversation.service.ts` (`answerRead`, `READ_INTENTS`, `isReadIntent`, `infoReply`, `toCents`, `todayYmd`), `replies.ts` (`formatBrl` e os templates), `conversation.types.ts` (`ReplyData`), `conversation.module.ts`, e os specs.
3. Os serviços que você vai consumir (só leia, não altere): `backend/src/recurring-transactions/recurring-transactions.service.ts` (`list`, `toRecurringResponse`), `backend/src/installments/installments.service.ts` (`list`, `toInstallmentResponse`), `backend/src/goals/goals.service.ts` (`list`, `serializeGoal`) e `backend/src/recurring-transactions/recurrence.util.ts` (`localToday`, `addDaysUtc`, `monthToDateUtc`).

## O que fazer

1. **Matcher** (`parsers/intent.matcher.ts`): adicionar `upcoming_dues | installments | fixed_bills | goals` a `ReadIntent`, com as frases do contrato (seção 2). Mesma regra de hoje: texto igual à frase ou começando por ela mais espaço. Ordem: depois de `create_*` e `spend_by_category`, antes de `credit_card`. Teste que as sugestões prontas do Selah NÃO casam (ex.: "Como posso acelerar minhas metas financeiras?", "Qual meta merece aporte agora?", "Analise meus gastos do mês", "Como estou hoje?").
2. **Motor** (`conversation.service.ts`): estender `READ_INTENTS`/`isReadIntent` e `answerRead` com os 4 casos. Cada caso chama o serviço certo com o `userId` do motor, aplica as regras de filtro, ordem, limites (5 itens; 8 em vencimentos), janela de 30 dias, total e texto da seção 3 do contrato. Truncar descrição em 60 caracteres com "…". Datas no texto como `dd/mm`. Valores em centavos inteiros (`toCents`) e `formatBrl`.
3. **Textos** (`replies.ts`): um template por consulta, pt-BR, curto, com quebras de linha como o exemplo da seção 4 do contrato. Tom técnico e direto, sem exclamação.
4. **Tipos** (`conversation.types.ts`): acrescentar a `ReplyData` os campos `dues`, `installments`, `fixedBills`, `goals`, `totalCents` exatamente como na seção 4 do contrato.
5. **Módulo** (`conversation.module.ts`): importar `GoalsModule`, `InstallmentsModule`, `RecurringTransactionsModule`. Injetar os 3 serviços no construtor de `ConversationService`. Atualizar os specs que constroem o serviço manualmente.
6. **Falha de serviço** (seção 5 do contrato): envolver a execução de qualquer leitura (as antigas e as 4 novas) de modo que exceção vire `ConversationReply` com `kind: 'ERROR'`, texto genérico "Não consegui consultar agora. Tente de novo.", evento `ERROR` sem o texto da mensagem, e nenhum detalhe interno na resposta. Um ponto só, não um try/catch por caso.

## Regras que não podem quebrar

- `userId` só do argumento do motor, repassado ao serviço. Nenhum id vindo do texto da mensagem.
- Não gravar nada, não criar rota, DTO, tabela nem migration.
- Não mexer em nenhum arquivo fora de `backend/src/conversation/`.
- Não registrar texto de mensagem em log nem em evento.
- Não calcular de novo o que o serviço já devolve (D2 do contrato): o motor só filtra, soma e formata.
- Janela e limites são constantes nomeadas no topo do arquivo, não números soltos.

## Testes (jest, no estilo dos specs existentes)

Cubra a seção 6 do contrato inteira. Pontos que costumam escapar:

- Fronteira da janela: vencimento no dia 29 entra, no dia 30 não; "hoje" no fuso do usuário (use `jest.useFakeTimers({ now })` com o relógio travado, como o spec já faz com `T0`).
- Conta fixa semanal conta uma vez.
- `goals`: `floor` do percentual, teto de 100%, cofrinho sem alvo, aviso de metas fora da lista.
- Isolamento A/B: o serviço é chamado com `'A'` quando o usuário é A; o resultado de B nunca aparece. Faça o mutante à mão: troque o `userId` repassado e confirme que o teste quebra; desfaça.
- Falha do serviço devolve `ERROR` genérico, inclusive para uma leitura antiga (`balance`).
- Leitura durante rascunho em coleta mantém o rascunho.

## Como verificar (rode e cole a saída resumida)

Dentro de `backend/`:
1. `npx jest src/conversation`
2. `npx jest` (inteiro; hoje 44 suites, 746 testes)
3. `npx nest build`
4. `TZ=UTC npx jest src/conversation` e `TZ=Asia/Tokyo npx jest src/conversation` (a janela de 30 dias não pode depender do fuso do servidor).
Na raiz, ao final: `graphify update .` (um só, nunca em paralelo).

## Proibições

- Não fazer commit, push, amend, reset nem deploy. Deixe as mudanças na árvore; o agente principal commita depois da revisão.
- Sem segredo em arquivo. Sem dependência npm nova. Não "melhorar" código fora do escopo.

## Relatório final (curto)

Arquivos criados e alterados, saída resumida dos comandos, decisões onde o contrato era omisso, dúvidas registradas e o que você NÃO conseguiu verificar.
