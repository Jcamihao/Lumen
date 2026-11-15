# Finanças por conversa: contrato do item 1

Data: 2026-11-15
Status: aprovado pelo dono em 2026-11-15. Nenhum código, migration ou rota foi criado ainda. As decisões abertas da seção 10 seguem com a recomendação indicada até o dono dizer o contrário.

Este documento fecha o item 1 da "Ordem de implementação" de `2026-11-14-assistente-manual-financas.md`: DTOs, estados persistidos, resposta do roteador e chave idempotente. O item 2 (consultas e lançamento de gasto/receita no app) implementa em cima dele sem precisar decidir nada de novo.

## 1. Decisões deste contrato

Cada decisão tem o motivo. O dono pode trocar qualquer uma antes do item 2.

| # | Decisão | Por quê |
|---|---|---|
| D1 | Módulo novo `backend/src/conversation/`. O `AssistantService` (2.200+ linhas) não cresce. | O motor precisa ser independente de canal (spec); mexer no monólito mistura refatoração com feature. |
| D2 | Estado e rascunho ficam no **Postgres**, não no Redis. | A confirmação é dinheiro: precisa sobreviver a reinício e permitir constraint única para idempotência. Redis perderia o rascunho e não dá unicidade transacional. |
| D3 | Idempotência da mensagem por `messageId` único; idempotência da confirmação por `appliedKey` único. | Reentrega do WhatsApp e duplo toque no app não podem criar duas transações (regra da spec). |
| D4 | Confirmar é "reivindicar, depois aplicar" (seção 7). | `TransactionsService.create` não aceita transação de banco externa (verifiquei: usa `this.prisma` direto), então não dá para gravar o lançamento e fechar o rascunho no mesmo `$transaction`. |
| D5 | Mensagem repetida devolve `DUPLICATE`, sem reprocessar e sem guardar a resposta anterior. | Guardar a resposta guardaria texto financeiro. O app busca o estado atual em `GET /conversation/session`. |
| D6 | A tabela de eventos não guarda o texto da mensagem. | A spec pede métrica de intenção e resultado, não texto financeiro bruto. |
| D7 | Rota HTTP só para o canal APP. O WhatsApp (item 5) chama o motor por serviço interno, não por HTTP. | O WhatsApp resolve identidade por vínculo validado no servidor, não por JWT. Um adaptador por canal, um motor. |

## 2. Fronteira de identidade (regra de segurança)

- `userId` nunca aparece em DTO de entrada. O `ValidationPipe` global do app (`whitelist`, `forbidNonWhitelisted`, verificado em `main.ts`) já devolve 400 para campo extra, então um corpo com `userId` é rejeitado antes de chegar ao serviço.
- O controller lê o `userId` de `@CurrentUser() user.sub` (JWT) e o passa ao motor como argumento separado da mensagem.
- Toda consulta e escrita do módulo leva `userId` no `where`. Um id de rascunho de outra conta responde `404`, igual a um id inexistente.
- O motor recebe `ConversationInput` já com identidade resolvida; ele não sabe como o canal descobriu o dono.

## 3. Tipos do motor (canal-agnóstico)

```ts
type ConversationChannel = 'APP' | 'WHATSAPP';

// Montado pelo adaptador do canal. userId vem só de JWT ou vínculo validado.
interface ConversationInput {
  userId: string;
  channel: ConversationChannel;
  messageId: string;   // APP: UUID gerado pelo cliente. WHATSAPP: id da mensagem do provedor.
  text: string;        // 1 a 500 caracteres, já com trim.
  receivedAt: Date;    // relógio do servidor, nunca do cliente.
}

type ConversationState =
  | 'COLLECTING_FIELDS'
  | 'AWAITING_CONFIRMATION'
  | 'AWAITING_IMPORT_FILE'     // reservado: item 4
  | 'AWAITING_IMPORT_REVIEW'   // reservado: item 4
  | 'PROCESSING';              // reservado: item 4

type ConversationReplyKind =
  | 'INFO'            // resposta de leitura
  | 'ASK_FIELD'       // falta um campo; uma pergunta objetiva
  | 'CONFIRM_DRAFT'   // rascunho completo, aguardando confirmar ou cancelar
  | 'DONE'            // ação gravada
  | 'CANCELLED'
  | 'EXPIRED'         // rascunho descartado por tempo
  | 'HELP'            // não reconheceu; mostra exemplos
  | 'DUPLICATE'       // messageId já processado; nada foi feito
  | 'ERROR';          // erro tratável; texto já é seguro para o usuário

interface ConversationReply {
  kind: ConversationReplyKind;
  state: ConversationState | 'IDLE';  // estado depois desta resposta
  text: string;                       // texto curto, em template, pt-BR
  draft?: DraftView;                  // presente em ASK_FIELD e CONFIRM_DRAFT
  data?: ReplyData;                   // presente em INFO e DONE (seção 6)
  quickReplies?: string[];            // ex.: ['confirmar', 'cancelar'], no máximo 5
}
```

`COMPLETED`, `CANCELLED` e `FALLBACK` da spec são tipos de resposta, não linhas no banco: depois deles a sessão volta a `IDLE` (nenhuma linha ativa). `FALLBACK` não existe neste contrato (item 7).

## 4. Rotas (canal APP)

Módulo `conversation`, controller `@Controller('conversation')`, todas autenticadas.

| Método e rota | Corpo | Resposta | Uso |
|---|---|---|---|
| `POST /conversation/message` | `{ messageId: uuid, text: string }` | `ConversationReply` | Toda mensagem digitada, inclusive `confirmar` e `cancelar` por texto. |
| `POST /conversation/confirm` | `{ draftId: uuid, draftVersion: int }` | `ConversationReply` | Botão "Confirmar" do cartão de rascunho. |
| `POST /conversation/cancel` | `{ draftId: uuid }` | `ConversationReply` | Botão "Cancelar". |
| `GET /conversation/session` | nenhum | `{ state, draft? }` | O app reabre e recupera onde parou; também resolve `DUPLICATE`. |

DTOs (todos com `class-validator`, mesmo padrão do `AskAssistantDto`):

- `SendConversationMessageDto`: `messageId` `@IsUUID()`, `text` `@IsString() @MinLength(1) @MaxLength(500)`.
- `ConfirmConversationDraftDto`: `draftId` `@IsUUID()`, `draftVersion` `@IsInt() @Min(1)`.
- `CancelConversationDraftDto`: `draftId` `@IsUUID()`.

Erros:

| Caso | HTTP | Corpo |
|---|---|---|
| Validação | 400 | padrão do Nest |
| Sem token | 401 | padrão do app |
| Rascunho inexistente, de outra conta, ou já consumido | 404 | `{ "message": "Rascunho não encontrado" }`, idêntico nos três casos |
| Rascunho expirado | 200 | `ConversationReply` com `kind: 'EXPIRED'` |
| Falha ao gravar o lançamento | 200 | `ConversationReply` com `kind: 'ERROR'` e o rascunho preservado |

Não existe `userId`, `accountId` nem `channel` no corpo. O canal do app é fixado no controller.

## 5. Persistência (Prisma)

Convenções do `schema.prisma` atual: `id String @id @default(uuid())`, `userId`, relação com `onDelete: Cascade`, `@db.Decimal` só onde há dinheiro.

```prisma
enum ConversationChannel {
  APP
  WHATSAPP
}

enum ConversationState {
  COLLECTING_FIELDS
  AWAITING_CONFIRMATION
  AWAITING_IMPORT_FILE
  AWAITING_IMPORT_REVIEW
  PROCESSING
}

enum ConversationOutcome {
  RECOGNIZED
  COMPLETED
  CANCELLED
  EXPIRED
  UNRECOGNIZED
  DUPLICATE
  ERROR
}

// Uma sessão ativa por usuário e canal. Não existe linha = IDLE.
model ConversationSession {
  id        String              @id @default(uuid())
  userId    String
  channel   ConversationChannel
  state     ConversationState
  intent    String              // id da seção 6, ex.: "create_expense"
  // Só campos já informados ou confirmados. Nunca segredo nem conteúdo bruto de documento.
  draft     Json
  // Sobe a cada mudança do rascunho. Confirmar exige a versão que o usuário viu.
  version   Int                 @default(1)
  expiresAt DateTime
  createdAt DateTime            @default(now())
  updatedAt DateTime            @updatedAt
  user      User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, channel])
  @@index([expiresAt])
}

// Idempotência e métrica. Não guarda o texto da mensagem (decisão D6).
model ConversationEvent {
  id         String              @id @default(uuid())
  userId     String
  channel    ConversationChannel
  messageId  String?             // preenchido em mensagens; nulo em confirmar/cancelar por botão
  intent     String?
  outcome    ConversationOutcome
  // Preenchido só quando uma ação financeira foi aplicada: `${sessionId}:${version}`.
  appliedKey String?             @unique
  // Id do registro criado (ex.: Transaction.id), para auditoria.
  resultRef  String?
  createdAt  DateTime            @default(now())
  user       User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, channel, messageId])
  @@index([userId, createdAt])
}
```

Nota sobre `@@unique([userId, channel, messageId])`: no Postgres, `messageId` nulo não conflita, então eventos de botão podem repetir sem erro.

Relações no model `User`: adicionar `conversationSessions ConversationSession[]` e `conversationEvents ConversationEvent[]` na relação do model `User`.

Expiração: preguiçosa. Ao ler uma sessão com `expiresAt < agora`, o motor responde `EXPIRED` uma vez, apaga a linha e registra o evento. Limpeza em lote de linhas esquecidas fica fora do item 2.

Prazos (da spec): `COLLECTING_FIELDS` 15 minutos sem mensagem; `AWAITING_CONFIRMATION` 5 minutos. Cada mensagem que muda o rascunho renova `expiresAt` com o prazo do estado novo.

## 6. Intenções e rascunhos

Ids de intenção (strings fixas, as 15 do plano de lançamento). A coluna "Item" diz quando cada uma é implementada.

| Id | Tipo | Item |
|---|---|---|
| `balance`, `month_summary`, `spend_total`, `spend_by_category` | leitura | 2 |
| `upcoming_dues`, `installments`, `fixed_bills`, `goals` | leitura | 3 |
| `credit_card` (limite, usado, disponível, fechamento, vencimento do cartão único) | leitura | 2 |
| `imported_receipts`, `item_price`, `item_compare`, `import_receipt` | leitura e importação | 4 |
| `create_expense`, `create_income` | escrita com confirmação | 2 |
| `set_credit_limit` (via `CreditCycleService.setCeiling`) | escrita com confirmação | 3 |
| `help` | ajuda | 2 |

Rascunho de `create_expense` e `create_income` (campo `draft` do `ConversationSession`):

```ts
interface ExpenseOrIncomeDraft {
  type: 'EXPENSE' | 'INCOME';
  amountCents: number;          // inteiro, positivo. Convertido para reais só ao aplicar.
  description: string;          // 2 a 120 caracteres
  categoryId: string | null;    // sempre da conta do dono; validado ao aplicar
  date: string;                 // 'YYYY-MM-DD' no fuso do usuário
  paymentMethod: 'PIX' | 'CREDIT' | 'DEBIT' | null;
}
```

`DraftView` (o que vai para a tela) é o mesmo objeto com `amount` já formatado e o nome da categoria, nunca ids internos além do `draftId` e `draftVersion`.

Aplicação: monta `CreateTransactionDto` (`type`, `description`, `amount` em reais, `date` ISO, `categoryId`, `paymentMethod`) e chama `TransactionsService.create(userId, dto)`. É o mesmo serviço da tela de Finanças, então valida categoria e dono do mesmo jeito.

### Regras do parser (padrão proposto)

- Valor aceito: `32,90`, `32.90`, `1.234,56`, `1234`, `2 mil`, `2k`. `1.234` vale 1234 (ponto de milhar). Qualquer outro caso com vírgula e ponto ambíguos, como `1,234`, gera uma pergunta, nunca um palpite. Zero, negativo ou acima de 1.000.000 pede correção.
- Data: `hoje` (padrão), `ontem`, `anteontem`, `dd/mm`, `dd/mm/aaaa`. Sempre no fuso `User.timezone`, usando `localToday` como o `CreditCycleService` já faz. Data futura pede confirmação explícita no rascunho.
- Categoria: compara o texto sem acento e sem caixa com as `FinanceCategory` do usuário do mesmo `type`, por igualdade e depois por prefixo. Mais de uma candidata: pergunta uma vez, com até 5 opções. Nenhuma: pergunta uma vez e aceita `sem categoria`.
- `confirmar`, `sim`, `ok` só valem em `AWAITING_CONFIRMATION`. `cancelar`, `parar`, `voltar` descartam o rascunho em qualquer estado. Fora disso, "ok" não faz nada.

## 7. Confirmação sem duplicar (D3, D4)

Algoritmo de `confirm` (por botão ou por texto):

1. Carregar a sessão com `where: { id, userId, state: 'AWAITING_CONFIRMATION' }`. Não achou, ou `version` diferente da enviada: 404 (botão) ou `HELP` (texto).
2. Expirada: apagar e responder `EXPIRED`.
3. **Reivindicar:** `deleteMany({ where: { id, userId, version } })`. Se `count !== 1`, outro pedido já consumiu o rascunho: responder `DUPLICATE`.
4. Criar `ConversationEvent` com `appliedKey = ${sessionId}:${version}`. Violação de unicidade em `appliedKey`: responder `DUPLICATE`. Violação em `(userId, channel, messageId)` (reentrega concorrente da mesma mensagem, achada na revisão do item 2a): o rascunho já foi reivindicado por este pedido, então grava o evento de novo sem `messageId` e segue para o passo 5; tratar como `DUPLICATE` perderia a confirmação.
5. Aplicar a ação (chamar o serviço financeiro). Sucesso: gravar `resultRef` e responder `DONE`.
6. Falha ao aplicar: recriar a sessão no estado `AWAITING_CONFIRMATION` com a mesma `version`, remover o `appliedKey` do evento (ou marcar `outcome: ERROR`) e responder `ERROR`. Se o usuário já abriu outro rascunho nesse intervalo (a regra `@@unique([userId, channel])` impede duas sessões), o rascunho antigo não é restaurado e a resposta `ERROR` pede para refazer.

Garantia e limite, ditos sem enfeite: dois pedidos concorrentes nunca criam dois lançamentos, porque só um passa do passo 3. Se o processo cair entre o passo 3 e o 5, o rascunho se perde e nada é gravado; o usuário refaz. Esse é o lado seguro: perder um rascunho é melhor que lançar duas vezes.

## 8. Eventos e métricas

Um `ConversationEvent` por mensagem processada, com `intent` e `outcome`. Entrada não reconhecida grava `outcome: UNRECOGNIZED` sem texto. Contagem por intenção e por resultado responde "quais comandos criar a seguir" sem guardar frase do usuário. Se o dono quiser saber *o que* as pessoas digitam, é decisão nova (seção 10).

## 9. Testes que este contrato exige do item 2

- Corpo com `userId` extra: 400.
- Contas A e B: A confirma/cancela/lê o `draftId` de B: 404 idêntico ao de id inexistente; nada de B muda.
- Mesmo `messageId` duas vezes: segunda resposta `DUPLICATE`, uma só transação.
- `confirm` duas vezes e duas em paralelo: uma transação.
- Confirmar com `draftVersion` antigo depois de editar o rascunho: rejeitado.
- Expiração: 15 min na coleta, 5 min na confirmação, usando relógio controlado.
- Falha de `TransactionsService.create` no passo 5: rascunho de volta, nenhum lançamento.
- Mutante de segurança: remover `userId` do `where` do passo 1 ou 3 faz o teste de A/B quebrar. Esse item é de segurança, então exige revisor (regra do dono).
- Parser: cada formato de valor e data da seção 6, mais os casos ambíguos.

## 10. Decisões abertas do dono

1. Guardar o texto de mensagens não reconhecidas para descobrir comandos novos, ou ficar só com contagem por intenção? Recomendação: só contagem no lançamento.
2. Datas futuras em gasto: pedir confirmação extra (padrão deste contrato) ou bloquear?
3. Limite de taxa por usuário (mensagens por minuto): o app não tem `Throttler` (não encontrei no código). Recomendação: decidir antes do WhatsApp, não no item 2.

## 11. Fora deste contrato

- Chave `ASSISTANT_LLM_MODE` (OFF/FALLBACK): item 3 da Fase 0 do plano de lançamento.
- Importação de nota, WhatsApp, fallback de IA, edição e exclusão: itens 4, 5, 7 e 8.
- Vários cartões nomeados: feature de Finanças, depois do bot.
