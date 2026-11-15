# Brief: Finanças por conversa, item 2a (backend)

Para: subagente de desenvolvimento (haiku). Relatório final em estilo curto, sem enfeite.
Projeto: `/home/caminhao/coding/codeStage/Lumen`. Trabalhe só em `backend/` (mais `backend/prisma/`). Não toque em `frontend/`.

## Objetivo

Implementar o motor de conversa do contrato aprovado, no canal APP, para estas intenções: `balance`, `month_summary`, `spend_total`, `spend_by_category`, `credit_card`, `help`, `create_expense`, `create_income`. Mais as 4 rotas, as 2 tabelas e os testes.

Fora do escopo (não implemente): `upcoming_dues`, `installments`, `fixed_bills`, `goals`, `set_credit_limit` (item 3), importação de nota (item 4), WhatsApp (item 5), fallback de IA (item 7), editar/excluir (item 8), qualquer mudança no `frontend/`, qualquer mudança no `AssistantService`.

## Leia antes de escrever código (nesta ordem)

1. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-1.md`: **fonte única**. Tipos, rotas, schema Prisma, algoritmo de confirmação (seção 7), regras do parser (seção 6) e testes exigidos (seção 9). Siga ao pé da letra. Dúvida ou conflito: não decida sozinho; escreva em `.superpowers/sdd/conversa-item-2/duvidas.md` e pare naquele ponto.
2. `docs/superpowers/specs/2026-11-14-assistente-manual-financas.md`: regras de segurança e isolamento (seção "Isolamento obrigatório entre contas").
3. Padrões do código para copiar: `backend/src/credit-cycle/` (service, controller, DTOs, spec com prisma mockado), `backend/src/transactions/transactions.service.ts` (`create`), `backend/src/common/decorators/current-user.decorator.ts`.

## O que construir

Pasta nova `backend/src/conversation/`:

- `conversation.module.ts`: importa `TransactionsModule`, `DashboardModule`, `CreditCycleModule` e o módulo do Prisma, como os outros módulos fazem. Registre em `backend/src/app.module.ts`.
- `conversation.controller.ts`: `@Controller('conversation')`, 4 rotas da seção 4 do contrato. `userId` vem só de `@CurrentUser() user.sub`.
- `dto/`: os 3 DTOs da seção 4.
- `conversation.service.ts`: o motor. Entrada `ConversationInput` (seção 3), saída `ConversationReply`. Sem nenhum acoplamento a HTTP, para o WhatsApp reaproveitar depois.
- `parsers/`: `amount.parser.ts`, `date.parser.ts`, `intent.matcher.ts`, cada um puro (sem Prisma), com `.spec.ts` ao lado.
- `replies.ts`: templates de texto pt-BR e formatação de dinheiro (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`).
- Em `backend/prisma/schema.prisma`: enums e models da seção 5 do contrato, mais as duas relações no `User`. Gere a migration com `npx prisma migrate dev --name conversation_item_2` (rode a partir de `backend/`).

### Ordem de decisão do motor, por mensagem

1. Checar idempotência: `ConversationEvent` com `(userId, channel, messageId)`. Já existe: responder `DUPLICATE` e parar.
2. Carregar a sessão ativa do `(userId, channel)`. Expirada: apagar, registrar evento `EXPIRED`, responder `EXPIRED`.
3. Se há sessão: tratar `cancelar`/`parar`/`voltar` (qualquer estado) e `confirmar`/`sim`/`ok` (só em `AWAITING_CONFIRMATION`), ou preencher o campo que falta (`COLLECTING_FIELDS`).
4. Sem sessão (ou mensagem não casou com a sessão): casar intenção.
5. Não reconheceu: `HELP`, evento `UNRECOGNIZED`, **sem guardar o texto**.

### Reconhecimento de intenção (normalize: minúsculas, sem acento, espaços colapsados)

| Intenção | Casa quando |
|---|---|
| `create_expense` | começa com valor (`50 mercado`) ou com `gastei`/`paguei`/`comprei` seguido de valor |
| `create_income` | começa com `recebi`/`entrada de`/`ganhei` seguido de valor |
| `balance` | `saldo`, `quanto tenho` |
| `month_summary` | `resumo`, `resumo do mes` |
| `spend_by_category` | `gastos com X`, `quanto gastei com X` (X vira o nome de categoria) |
| `spend_total` | `quanto gastei`, `gastos`, `gastos do mes` (só depois de testar `spend_by_category`) |
| `credit_card` | `cartao`, `limite`, `quanto sobrou no cartao`, `limite do cartao` |
| `help` | `ajuda`, `o que voce faz` |

Intenção de escrita sempre cria rascunho e responde `CONFIRM_DRAFT`; nunca grava na primeira mensagem.

### De onde vêm os números das leituras (mesmos números das telas)

- `balance`, `month_summary`, `spend_total`: `DashboardService.getSummary(userId).finances` (`balance`, `monthlyExpenses`, `monthlyIncome`). Não reescreva a fórmula; o saldo do app conta `INCOME` positivo e o resto negativo.
- `spend_by_category`: `prisma.transaction.groupBy` por `categoryId` com `where: { userId, type: 'EXPENSE', date: { gte: início do mês, lte: agora } }`, copiando o filtro de data de `monthlyExpenseAggregate` em `dashboard.service.ts`. Resolva o nome da categoria com `prisma.financeCategory.findMany({ where: { userId } })`.
- `credit_card`: `CreditCycleService.getCurrent(userId)` (campos `ceiling`, `spent`, `remaining`, `percentUsed`, `status`, `closingDay`, `dueDay`). Sem teto definido (`ceiling === null`): responder que não há limite definido neste ciclo.

### Aplicar escrita

`create_expense`/`create_income`: ao confirmar, montar `CreateTransactionDto` e chamar `TransactionsService.create(userId, dto)`. `amountCents / 100` vira `amount`. Algoritmo de confirmação exatamente como na seção 7 do contrato (reivindicar com `deleteMany` por `id + userId + version`, depois `appliedKey`, depois aplicar).

## Regras que não podem quebrar

- `userId` em **todo** `where` de `ConversationSession` e `ConversationEvent`. Nenhuma busca só por `id`.
- Nunca ler `userId` de corpo, query ou header. Só do argumento que o controller passa.
- Não registrar texto de mensagem em log nem em `ConversationEvent`.
- Valor monetário nunca em `float` dentro do rascunho: inteiro em centavos.
- Não alterar nenhum arquivo fora de `backend/src/conversation/`, `backend/src/app.module.ts` e `backend/prisma/` (schema e migration).

## Testes (jest, prisma mockado como em `credit-cycle.service.spec.ts`)

Cubra a lista da seção 9 do contrato, e mais:

- cada formato de valor e de data (`32,90`, `32.90`, `1.234,56`, `1.234`, `2 mil`, `2k`, `1,234` ambíguo, zero, negativo, acima de 1.000.000; `hoje`, `ontem`, `anteontem`, `dd/mm`, `dd/mm/aaaa`);
- teste de isolamento com **duas contas** (A e B) no mesmo serviço: A não lê, confirma nem cancela rascunho de B;
- `confirmar` fora de `AWAITING_CONFIRMATION` não faz nada;
- expiração com relógio controlado (`jest.useFakeTimers`): 15 min coleta, 5 min confirmação;
- duas confirmações concorrentes (`Promise.all`) geram uma única chamada a `TransactionsService.create`;
- falha em `TransactionsService.create` devolve o rascunho e nenhum lançamento.

## Como verificar (rode e cole a saída resumida no relatório)

Dentro de `backend/`:

1. `npx jest src/conversation` — tudo verde.
2. `npx jest` — a suíte inteira continua verde (hoje: 39 suites, 609 testes).
3. `npx nest build` — sem erros.
4. `npx eslint "src/conversation/**/*.ts"` — sem erros. Não rode `npm run lint` (tem `--fix` na árvore toda).
5. Banco para a migration: a partir da raiz, `npm run dev:infra` (Postgres porta 5433). Não mexa nos containers `agilis-*`; são de outro projeto.
6. Ao terminar, na raiz: `graphify update .` (um só, nunca em paralelo).

## Proibições

- Não fazer commit, push, amend, reset nem deploy. Deixe as mudanças na árvore de trabalho; o agente principal commita depois da revisão.
- Não por segredo, chave ou senha em arquivo nenhum.
- Não adicionar dependência npm sem pedir.
- Não "melhorar" código fora do escopo.

## Relatório final (curto)

Liste: arquivos criados/alterados, nome da migration, saída resumida dos 4 comandos, qualquer dúvida registrada em `duvidas.md`, e o que você **não** conseguiu verificar.
