# Contrato de tipos: item 3b2a

Data: 2026-11-15. Estado: implementado no backend (2026-11-15). Formato abaixo conferido por teste e por JSON capturado de uma execução real dos testes do motor (sem banco). Nada foi verificado no frontend. Este arquivo complementa o contrato aprovado do 3b2 sem antecipar tipos do 3b2b.

## 1. Mudanças no contrato HTTP existente

Rotas, autenticação e DTOs de entrada de `message`, `confirm`, `cancel` e `session` permanecem iguais aos do item 1. Corpo HTTP nunca traz `userId`, mês, ciclo, preço ou snapshot financeiro fornecido pelo cliente.

`DraftKind` ganha apenas `ENVELOPE` e `CREDIT_LIMIT`. `PendingField` ganha apenas `name`; `amount` já existe. `ReplyData` ganha `envelopeId?: string`. Os tipos existentes de metas, aportes e lançamentos não mudam.

Os novos rascunhos usam `type: 'EXPENSE'` nos campos legados, com `amount`, `description`, `category`, `date` e `paymentMethod` nulos. `kind`, `title`, `rows`, `pendingField`, `draftId` e `draftVersion` são os campos efetivos da tela. Título é `Reserva` ou `Limite do cartão`.

## 2. Dados internos da sessão

```ts
interface EnvelopeDraft {
  kind: 'ENVELOPE';
  name: string | null;
  monthlyCents: number | null;
  color: string; // '#f18f01'
  provisionMonth: string; // 'AAAA-MM-01', mês UTC mostrado no cartão
  pendingField: 'name' | 'amount' | null;
}
interface CreditLimitDraft {
  kind: 'CREDIT_LIMIT';
  ceilingCents: number | null;
  cycleStart: string; // 'AAAA-MM-DD'
  cycleEnd: string;
  previousCeilingCents: number | null;
  countAllPayments: boolean;
  pendingField: 'amount' | null;
}
```

`provisionMonth` é o detalhamento técnico para manter congelado o mês já mostrado; é recalculado e exige nova confirmação quando mudar. Não é uma data editável pelo usuário. Não mudar a política UTC existente dos envelopes para o fuso local.

## 3. Recibos internos dos serviços

```ts
interface EnvelopeWriteReceipt {
  id: string;
  name: string;
  monthlyCents: number;
  provisionMonth: string;
  refreshPending: boolean;
}
interface CreditLimitExpectation {
  cycleStart: string;
  cycleEnd: string;
  previousCeilingCents: number | null;
  countAllPayments: boolean;
}
interface CreditLimitWriteReceipt {
  id: string; // CreditCycleCeiling.id; não existe id de cartão no v0
  ceilingCents: number;
  cycleStart: string;
  cycleEnd: string;
  refreshPending: boolean;
}
```

Não serializar esses recibos inteiros para o navegador. São o contrato entre domínio e motor. A condição de revisão do cartão contém somente `CreditLimitExpectation` derivada do dono autenticado; mudança de mês contém o novo `provisionMonth`. O formato interno do erro pode ser uma classe pequena por módulo, sem ser DTO HTTP.

## 4. Linhas e respostas da tela

Reserva completa:

```json
{
  "kind": "ENVELOPE",
  "title": "Reserva",
  "pendingField": null,
  "rows": [
    { "label": "Nome", "value": "gasolina" },
    { "label": "Valor mensal", "value": "R$ 400,00" },
    { "label": "Início", "value": "11/2026 (UTC)" },
    { "label": "Aviso", "value": "A reserva recebe a provisão mensal do app. Isso não transfere dinheiro de uma conta bancária nem faz aporte em meta." }
  ]
}
```

Cartão completo:

```json
{
  "kind": "CREDIT_LIMIT",
  "title": "Limite do cartão",
  "pendingField": null,
  "rows": [
    { "label": "Ciclo", "value": "31/10/2026 a 30/11/2026" },
    { "label": "Limite atual", "value": "R$ 2.000,00" },
    { "label": "Novo limite", "value": "R$ 5.000,00" },
    { "label": "Aviso", "value": "Este limite vale só para o ciclo mostrado." }
  ]
}
```

São recortes de `DraftView`, não respostas HTTP completas; acrescentar ids/versão e campos legados ao montar a resposta real. Formatação usa o utilitário monetário existente; espaços não separáveis de BRL não devem quebrar os testes. Quando `countAllPayments` é verdadeiro, outra linha `Aviso` informa que o ciclo considera todas as formas de pagamento.

Campo ausente aparece como `a informar`. `pendingField: 'name'` na restauração mostra "Falta informar: nome."; o botão Confirmar só aparece em `AWAITING_CONFIRMATION`, como já ocorre.

`DONE` da reserva: `data.envelopeId`, sem fabricar saldo. `DONE` do limite pode trazer `data: {}`; `card` é opcional e só pode ser preenchido com leitura autorizada bem-sucedida. `refreshPending` vira frase em `text`, não um estado de formulário novo.

Snapshot/mês alterado: `CONFIRM_DRAFT`, versão incrementada, linhas atualizadas e explicação em `text`; nenhum write foi feito. Resultado de commit desconhecido: `ERROR` + `IDLE`, sem `draft` e sem `quickReplies` de confirmar. A interface precisa remover os botões antigos e não criar retry de gravação para esse retorno de negócio.

## 5. Formato final (implementado)

Diferenças em relação às seções 1 a 4, decididas durante a implementação:

- `PendingField` ganhou `name` (reserva). `DraftKind` ganhou `ENVELOPE` e `CREDIT_LIMIT`.
- `EnvelopeDraft` e `CreditLimitDraft` ganharam `reviewReason?: string`. Ele é preenchido só quando a confirmação foi refeita por mudança de mês ou de ciclo/teto/opção. Aparece como linha `Atenção` em `rows`, também depois de restaurar a sessão e em `GET /conversation/session`.
- `rows` da reserva: `Nome`, `Valor mensal`, `Início` (`MM/AAAA (UTC)`), `Aviso`, e `Atenção` quando houver revisão. Campo ausente vira `a informar`.
- `rows` do limite: `Ciclo` (`DD/MM/AAAA a DD/MM/AAAA`), `Limite atual` (ou `não definido`), `Novo limite`, `Aviso` (ciclo), `Aviso` (todas as formas, só com a opção ligada), `Atenção` quando houver revisão. Não há ids internos nas linhas.
- `DONE` da reserva: `data: { envelopeId }`, `resultRef` = id do envelope. `DONE` do limite: `data: {}` (sem `card`, porque o brief pede não fabricar saldo), `resultRef` = id da linha `CreditCycleCeiling`.
- Aviso de atualização pendente (`refreshPending`) acrescenta uma linha ao `text` de `DONE`: `Cadastro salvo. A atualização dos dados está pendente; confira a tela de Finanças.` (ver duvidas.md, item sobre o texto).
- Commit desconhecido: `ERROR` com `state` `IDLE`, sem `draft`, sem `quickReplies`.
- Condição revisável: `CONFIRM_DRAFT` com `draftVersion` + 1, `text` com o motivo antes do corpo, e `rows` atualizadas.

Os JSONs abaixo foram capturados de uma execução do teste de motor com os mesmos serviços simulados usados nos testes. Os ids são de exemplo do fake (`env-9`, `ceil-1`).

### 5.1 Reserva completa (`criar reserva 400 gasolina`)

```json
{
  "kind": "CONFIRM_DRAFT",
  "state": "AWAITING_CONFIRMATION",
  "text": "Reserva gasolina: R$ 400,00 por mês, início em 11/2026 (UTC).",
  "draft": {
    "draftId": "7a79ddcb-7f3a-43e0-937d-f1d6a5dc0802",
    "draftVersion": 1,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "ENVELOPE",
    "title": "Reserva",
    "pendingField": null,
    "rows": [
      {
        "label": "Nome",
        "value": "gasolina"
      },
      {
        "label": "Valor mensal",
        "value": "R$ 400,00"
      },
      {
        "label": "Início",
        "value": "11/2026 (UTC)"
      },
      {
        "label": "Aviso",
        "value": "A reserva recebe a provisão mensal do app. Isso não transfere dinheiro de uma conta bancária nem faz aporte em meta."
      }
    ]
  },
  "quickReplies": [
    "confirmar",
    "cancelar"
  ]
}
```

### 5.2 Reserva confirmada (DONE)

```json
{
  "kind": "DONE",
  "state": "IDLE",
  "text": "Reserva criada: gasolina, R$ 400,00 por mês.",
  "data": {
    "envelopeId": "env-9"
  }
}
```

### 5.3 Reserva com nome pendente (`criar reserva 400`)

```json
{
  "kind": "ASK_FIELD",
  "state": "COLLECTING_FIELDS",
  "text": "Qual o nome da reserva? Ex.: gasolina.",
  "draft": {
    "draftId": "1eb6de80-11ae-447e-b7ff-3953f76f6292",
    "draftVersion": 1,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "ENVELOPE",
    "title": "Reserva",
    "pendingField": "name",
    "rows": [
      {
        "label": "Nome",
        "value": "a informar"
      },
      {
        "label": "Valor mensal",
        "value": "R$ 400,00"
      },
      {
        "label": "Início",
        "value": "11/2026 (UTC)"
      },
      {
        "label": "Aviso",
        "value": "A reserva recebe a provisão mensal do app. Isso não transfere dinheiro de uma conta bancária nem faz aporte em meta."
      }
    ]
  }
}
```

### 5.4 Limite completo (`definir limite do cartão 5000`)

```json
{
  "kind": "CONFIRM_DRAFT",
  "state": "AWAITING_CONFIRMATION",
  "text": "Limite de R$ 5.000,00 para o ciclo com fechamento em 05/12/2026.",
  "draft": {
    "draftId": "f1e9cdce-bc32-42b6-a064-fe1d9cef22b6",
    "draftVersion": 1,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "CREDIT_LIMIT",
    "title": "Limite do cartão",
    "pendingField": null,
    "rows": [
      {
        "label": "Ciclo",
        "value": "06/11/2026 a 05/12/2026"
      },
      {
        "label": "Limite atual",
        "value": "R$ 2.000,00"
      },
      {
        "label": "Novo limite",
        "value": "R$ 5.000,00"
      },
      {
        "label": "Aviso",
        "value": "Este limite vale só para o ciclo mostrado."
      }
    ]
  },
  "quickReplies": [
    "confirmar",
    "cancelar"
  ]
}
```

### 5.5 Limite com condição revisável (ciclo mudou antes da confirmação)

```json
{
  "kind": "CONFIRM_DRAFT",
  "state": "AWAITING_CONFIRMATION",
  "text": "O ciclo ou o limite atual mudou. Confira os dados atualizados e confirme novamente.\nLimite de R$ 5.000,00 para o ciclo com fechamento em 05/01/2027.",
  "draft": {
    "draftId": "f1e9cdce-bc32-42b6-a064-fe1d9cef22b6",
    "draftVersion": 2,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "CREDIT_LIMIT",
    "title": "Limite do cartão",
    "pendingField": null,
    "rows": [
      {
        "label": "Ciclo",
        "value": "06/12/2026 a 05/01/2027"
      },
      {
        "label": "Limite atual",
        "value": "não definido"
      },
      {
        "label": "Novo limite",
        "value": "R$ 5.000,00"
      },
      {
        "label": "Aviso",
        "value": "Este limite vale só para o ciclo mostrado."
      },
      {
        "label": "Aviso",
        "value": "Este ciclo considera todas as formas de pagamento."
      },
      {
        "label": "Atenção",
        "value": "O ciclo ou o limite atual mudou. Confira os dados atualizados e confirme novamente."
      }
    ]
  },
  "quickReplies": [
    "confirmar",
    "cancelar"
  ]
}
```

### 5.6 Limite confirmado (DONE, após a revisão)

```json
{
  "kind": "DONE",
  "state": "IDLE",
  "text": "Limite de R$ 5.000,00 definido para o ciclo com fechamento em 05/01/2027.",
  "data": {}
}
```

### 5.7 Erro de commit desconhecido

```json
{
  "kind": "ERROR",
  "state": "IDLE",
  "text": "Não foi possível confirmar o resultado. Confira a tela de Finanças antes de enviar o pedido novamente."
}
```

Depois desse erro, `getSession` responde `{ "state": "IDLE" }`: a sessão não é restaurada e a chave não é liberada (`sessaoAposCommitDesconhecido`).

### 5.8 Erros de abertura (texto exato, sem rascunho)

| Entrada | Resposta (`kind` / `text`) |
|---|---|
| `definir limite 5000 Nubank` | `ERROR` / "Envie só o valor do limite, sem nome de banco. Ex.: definir limite 5000." |
| `criar reserva 0 gasolina` | `ERROR` / "O valor precisa ser maior que zero." |
| `criar reserva 400 ` + nome de 61 caracteres | `ERROR` / "O nome da reserva passa de 60 caracteres." |
| `criar reserva 400 gasolina` com nome já usado | `ERROR` / "Você já tem um envelope com este nome." |
| plano sem vaga em `criar reserva` | `ERROR` / mensagem do `PlanLimitException` |
