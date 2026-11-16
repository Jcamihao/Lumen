# Contrato de tipos: item 3b2b (conta fixa e compra parcelada, backend)

Data: 2026-11-16. Estado: implementado no backend. Formato conferido por teste (suíte do motor, 242 testes verdes) e pelos JSONs abaixo, capturados de uma execução real dos testes do motor com os mesmos serviços simulados (sem banco). Os ids são do fake (`rec-9`, `inst-9`). Frontend ainda não foi alterado.

Complementa o contrato 3b2 (`docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b2.md`) e o `contrato-tipos.md` do 3b2a, sem repeti-los.

## 1. Tipos de sessão (internos, não vão para a tela)

```ts
interface RecurringDraft {
  kind: 'RECURRING';
  description: string | null;
  amountCents: number | null;
  frequency: 'MONTHLY' | 'WEEKLY' | 'YEARLY'; // padrão MONTHLY, sempre presente
  firstDueDate: string | null; // 'AAAA-MM-DD'
  pendingField: 'description' | 'amount' | 'firstDueDate' | null;
  reviewReason?: string;
}
interface InstallmentDraft {
  kind: 'INSTALLMENT';
  description: string | null;
  totalCents: number | null; // total da compra, nunca a parcela
  installmentsTotal: number | null; // 2 a 60
  firstDueDate: string | null;
  pendingField: 'description' | 'amount' | 'installmentsTotal' | 'firstDueDate' | null;
  reviewReason?: string;
}
```

`DraftKind` ganhou `RECURRING` e `INSTALLMENT`. `PendingField` ganhou `installmentsTotal` e `firstDueDate`. `ReplyData` ganhou `recurringTransactionId?` e `installmentPurchaseId?`. Nada além disso mudou.

Campos legados de `DraftView` (`type`, `amount`, `description`, `category`, `date`, `paymentMethod`) ficam nulos para os dois tipos, como em meta e aporte. A tela lê `kind`, `title`, `rows`, `pendingField`, `draftId`, `draftVersion`.

## 2. Recibos internos (domínio → motor, não serializados para a tela)

```ts
interface RecurringWriteReceipt {
  id: string; description: string; amountCents: number;
  frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  firstDueDate: string; // lido da linha gravada
  materializationPending: boolean; refreshPending: boolean;
}
interface InstallmentWriteReceipt {
  id: string; description: string; totalCents: number; installmentsTotal: number;
  installmentCents: number; lastInstallmentCents: number;
  firstDueDate: string; materializationPending: boolean; refreshPending: boolean;
}
```

Erros internos do núcleo: `RecurringFirstDueChangedError` / `InstallmentFirstDueChangedError` (carregam `today`), `RecurringWriteUncertainError` / `InstallmentWriteUncertainError` (commit desconhecido). Não viram DTO HTTP.

## 3. Linhas do cartão (`DraftView.rows`)

Conta fixa: `Descrição`, `Valor por vencimento`, `Frequência` (`Mensal`, `Semanal`, `Anual`), `Primeiro vencimento`, `Categoria` (`não informada`), `Forma de pagamento` (`não informada`), depois `Aviso` (zero a dois) e `Atenção` quando houver revisão.

Parcelado: `Descrição`, `Total da compra`, `Quantidade`, `Valor por parcela`, `Última parcela`, `Primeiro vencimento`, `Categoria`, `Forma de pagamento`, depois `Aviso` e `Atenção`.

Campo ausente = `a informar`. Parcela e última parcela ficam `a informar` enquanto total ou quantidade faltarem.

Avisos de vencimento: hoje → "Ao confirmar, será gerado o lançamento de hoje." (conta fixa) ou "...será gerada a parcela de hoje." (parcelado); futuro → "Os lançamentos serão gerados nos vencimentos."; sempre, com vencimento preenchido → "Outros cadastros já vencidos também podem ser atualizados junto, como na tela."

## 4. Textos de DONE e de erro

| Caso | Texto |
|---|---|
| Conta fixa criada | `Conta fixa criada: internet, R$ 120,00, mensal, primeiro vencimento em 20/11/2026.` |
| Parcelado criado | `Compra parcelada criada: geladeira, total R$ 1.200,00 em 12 parcelas, primeira em 20/11/2026.` |
| Materialização pendente | acrescenta linha: `Cadastro salvo. A atualização dos lançamentos está pendente; confira a tela de Finanças.` |
| Atualização pendente | acrescenta linha: `Cadastro salvo. A atualização dos dados está pendente; confira a tela de Finanças.` |
| Commit desconhecido | `ERROR` / `IDLE`: `Não foi possível confirmar o resultado. Confira a tela de Finanças antes de enviar o pedido novamente.` |
| Recusa 4xx ao confirmar | `Não foi possível criar a conta fixa. Confira os dados e envie o pedido de novo.` (ou da compra parcelada) |
| Data passada na abertura | `O primeiro vencimento não pode ser anterior a hoje. Para cadastrar o histórico, use a tela de Finanças.` |
| Parcela abaixo de R$ 0,01 | `Com essa quantidade, uma parcela ficaria abaixo de R$ 0,01. Escolha menos parcelas ou aumente o valor.` |

`DONE` traz `data: { recurringTransactionId }` ou `{ installmentPurchaseId }`; `resultRef` recebe o mesmo id no evento. Sem saldo, sem contagem inventados.

## 5. JSONs reais

### 5.1 Conta fixa completa (confirmação)



```json
{
  "kind": "CONFIRM_DRAFT",
  "state": "AWAITING_CONFIRMATION",
  "text": "Conta fixa internet: R$ 120,00 por vencimento, mensal, primeiro vencimento em 20/11/2026.",
  "draft": {
    "draftId": "6e75caa6-bb3d-44e2-8bb5-f9e6cf73062f",
    "draftVersion": 1,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "RECURRING",
    "title": "Conta fixa",
    "pendingField": null,
    "rows": [
      {
        "label": "Descrição",
        "value": "internet"
      },
      {
        "label": "Valor por vencimento",
        "value": "R$ 120,00"
      },
      {
        "label": "Frequência",
        "value": "Mensal"
      },
      {
        "label": "Primeiro vencimento",
        "value": "20/11/2026"
      },
      {
        "label": "Categoria",
        "value": "não informada"
      },
      {
        "label": "Forma de pagamento",
        "value": "não informada"
      },
      {
        "label": "Aviso",
        "value": "Os lançamentos serão gerados nos vencimentos."
      },
      {
        "label": "Aviso",
        "value": "Outros cadastros já vencidos também podem ser atualizados junto, como na tela."
      }
    ]
  },
  "quickReplies": [
    "confirmar",
    "cancelar"
  ]
}
```

### 5.2 Conta fixa confirmada (DONE)



```json
{
  "kind": "DONE",
  "state": "IDLE",
  "text": "Conta fixa criada: internet, R$ 120,00, mensal, primeiro vencimento em 20/11/2026.",
  "data": {
    "recurringTransactionId": "rec-9"
  }
}
```

### 5.3 Parcelado completo (confirmação)



```json
{
  "kind": "CONFIRM_DRAFT",
  "state": "AWAITING_CONFIRMATION",
  "text": "Compra parcelada geladeira: total R$ 1.200,00 em 12 parcelas, primeira em 20/11/2026.",
  "draft": {
    "draftId": "4c6aba1f-bde0-45c0-ba6b-48b4f2eaa32b",
    "draftVersion": 1,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "INSTALLMENT",
    "title": "Compra parcelada",
    "pendingField": null,
    "rows": [
      {
        "label": "Descrição",
        "value": "geladeira"
      },
      {
        "label": "Total da compra",
        "value": "R$ 1.200,00"
      },
      {
        "label": "Quantidade",
        "value": "12"
      },
      {
        "label": "Valor por parcela",
        "value": "R$ 100,00"
      },
      {
        "label": "Última parcela",
        "value": "R$ 100,00"
      },
      {
        "label": "Primeiro vencimento",
        "value": "20/11/2026"
      },
      {
        "label": "Categoria",
        "value": "não informada"
      },
      {
        "label": "Forma de pagamento",
        "value": "não informada"
      },
      {
        "label": "Aviso",
        "value": "Os lançamentos serão gerados nos vencimentos."
      },
      {
        "label": "Aviso",
        "value": "Outros cadastros já vencidos também podem ser atualizados junto, como na tela."
      }
    ]
  },
  "quickReplies": [
    "confirmar",
    "cancelar"
  ]
}
```

### 5.4 Parcelado confirmado (DONE)



```json
{
  "kind": "DONE",
  "state": "IDLE",
  "text": "Compra parcelada criada: geladeira, total R$ 1.200,00 em 12 parcelas, primeira em 20/11/2026.",
  "data": {
    "installmentPurchaseId": "inst-9"
  }
}
```

### 5.5 Pendência: descrição (ordem: descrição, valor, quantidade, vencimento)



```json
{
  "kind": "ASK_FIELD",
  "state": "COLLECTING_FIELDS",
  "text": "Qual a descrição? Ex.: internet ou geladeira.",
  "draft": {
    "draftId": "5bb2b1d2-8104-4595-8e91-b48bfc709b3d",
    "draftVersion": 1,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "RECURRING",
    "title": "Conta fixa",
    "pendingField": "description",
    "rows": [
      {
        "label": "Descrição",
        "value": "a informar"
      },
      {
        "label": "Valor por vencimento",
        "value": "R$ 120,00"
      },
      {
        "label": "Frequência",
        "value": "Mensal"
      },
      {
        "label": "Primeiro vencimento",
        "value": "a informar"
      },
      {
        "label": "Categoria",
        "value": "não informada"
      },
      {
        "label": "Forma de pagamento",
        "value": "não informada"
      }
    ]
  }
}
```

### 5.6 Pendência: valor da conta fixa



```json
{
  "kind": "ASK_FIELD",
  "state": "COLLECTING_FIELDS",
  "text": "Qual o valor de cada vencimento?",
  "draft": {
    "draftId": "6bab54c1-4874-4a4c-b9b5-0b3ccba36507",
    "draftVersion": 1,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "RECURRING",
    "title": "Conta fixa",
    "pendingField": "amount",
    "rows": [
      {
        "label": "Descrição",
        "value": "internet"
      },
      {
        "label": "Valor por vencimento",
        "value": "a informar"
      },
      {
        "label": "Frequência",
        "value": "Mensal"
      },
      {
        "label": "Primeiro vencimento",
        "value": "a informar"
      },
      {
        "label": "Categoria",
        "value": "não informada"
      },
      {
        "label": "Forma de pagamento",
        "value": "não informada"
      }
    ]
  }
}
```

### 5.7 Pendência: primeiro vencimento da conta fixa



```json
{
  "kind": "ASK_FIELD",
  "state": "COLLECTING_FIELDS",
  "text": "Qual o primeiro vencimento? Responda hoje ou uma data, como 20/11/2026.",
  "draft": {
    "draftId": "27dd5a32-4312-4e38-904a-2e6e675df176",
    "draftVersion": 1,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "RECURRING",
    "title": "Conta fixa",
    "pendingField": "firstDueDate",
    "rows": [
      {
        "label": "Descrição",
        "value": "internet"
      },
      {
        "label": "Valor por vencimento",
        "value": "R$ 120,00"
      },
      {
        "label": "Frequência",
        "value": "Mensal"
      },
      {
        "label": "Primeiro vencimento",
        "value": "a informar"
      },
      {
        "label": "Categoria",
        "value": "não informada"
      },
      {
        "label": "Forma de pagamento",
        "value": "não informada"
      }
    ]
  }
}
```

### 5.8 Pendência: quantidade do parcelado



```json
{
  "kind": "ASK_FIELD",
  "state": "COLLECTING_FIELDS",
  "text": "Em quantas parcelas? Responda um número de 2 a 60.",
  "draft": {
    "draftId": "651bcc43-77ae-48ee-9afd-7df08cc22981",
    "draftVersion": 1,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "INSTALLMENT",
    "title": "Compra parcelada",
    "pendingField": "installmentsTotal",
    "rows": [
      {
        "label": "Descrição",
        "value": "geladeira"
      },
      {
        "label": "Total da compra",
        "value": "R$ 1.200,00"
      },
      {
        "label": "Quantidade",
        "value": "a informar"
      },
      {
        "label": "Valor por parcela",
        "value": "a informar"
      },
      {
        "label": "Última parcela",
        "value": "a informar"
      },
      {
        "label": "Primeiro vencimento",
        "value": "a informar"
      },
      {
        "label": "Categoria",
        "value": "não informada"
      },
      {
        "label": "Forma de pagamento",
        "value": "não informada"
      }
    ]
  }
}
```

### 5.9 Vencimento hoje (aviso de geração imediata)



```json
{
  "kind": "CONFIRM_DRAFT",
  "state": "AWAITING_CONFIRMATION",
  "text": "Conta fixa internet: R$ 120,00 por vencimento, mensal, primeiro vencimento em 15/11/2026.",
  "draft": {
    "draftId": "d48cb4fc-cb54-41e0-9f04-5505e52a2554",
    "draftVersion": 1,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "RECURRING",
    "title": "Conta fixa",
    "pendingField": null,
    "rows": [
      {
        "label": "Descrição",
        "value": "internet"
      },
      {
        "label": "Valor por vencimento",
        "value": "R$ 120,00"
      },
      {
        "label": "Frequência",
        "value": "Mensal"
      },
      {
        "label": "Primeiro vencimento",
        "value": "15/11/2026"
      },
      {
        "label": "Categoria",
        "value": "não informada"
      },
      {
        "label": "Forma de pagamento",
        "value": "não informada"
      },
      {
        "label": "Aviso",
        "value": "Ao confirmar, será gerado o lançamento de hoje."
      },
      {
        "label": "Aviso",
        "value": "Outros cadastros já vencidos também podem ser atualizados junto, como na tela."
      }
    ]
  },
  "quickReplies": [
    "confirmar",
    "cancelar"
  ]
}
```

### 5.10 Erro na abertura: data passada (sem rascunho)



```json
{
  "kind": "ERROR",
  "state": "IDLE",
  "text": "O primeiro vencimento não pode ser anterior a hoje. Para cadastrar o histórico, use a tela de Finanças."
}
```

### 5.11 Erro na abertura: parcela abaixo de R$ 0,01 (sem rascunho)



```json
{
  "kind": "ERROR",
  "state": "IDLE",
  "text": "Com essa quantidade, uma parcela ficaria abaixo de R$ 0,01. Escolha menos parcelas ou aumente o valor."
}
```

### 5.12 Revisão: vencimento ficou no passado entre rascunho e confirmação

Nenhuma gravação. versão 1 → 2, estado de coleta, prazo de 15 minutos, linha Atenção.

```json
{
  "kind": "ASK_FIELD",
  "state": "COLLECTING_FIELDS",
  "text": "O primeiro vencimento ficou no passado. Informe uma nova data.\nQual o primeiro vencimento? Responda hoje ou uma data, como 20/11/2026.",
  "draft": {
    "draftId": "919c20bf-2874-4f89-a255-8cedba496bd7",
    "draftVersion": 2,
    "type": "EXPENSE",
    "amount": null,
    "description": null,
    "category": null,
    "date": null,
    "paymentMethod": null,
    "kind": "RECURRING",
    "title": "Conta fixa",
    "pendingField": "firstDueDate",
    "rows": [
      {
        "label": "Descrição",
        "value": "internet"
      },
      {
        "label": "Valor por vencimento",
        "value": "R$ 120,00"
      },
      {
        "label": "Frequência",
        "value": "Mensal"
      },
      {
        "label": "Primeiro vencimento",
        "value": "a informar"
      },
      {
        "label": "Categoria",
        "value": "não informada"
      },
      {
        "label": "Forma de pagamento",
        "value": "não informada"
      },
      {
        "label": "Atenção",
        "value": "O primeiro vencimento ficou no passado. Informe uma nova data."
      }
    ]
  }
}
```

### 5.13 DONE com aviso de materialização pendente



```json
{
  "kind": "DONE",
  "state": "IDLE",
  "text": "Conta fixa criada: internet, R$ 120,00, mensal, primeiro vencimento em 20/11/2026.\nCadastro salvo. A atualização dos lançamentos está pendente; confira a tela de Finanças.",
  "data": {
    "recurringTransactionId": "rec-9"
  }
}
```

### 5.14 Commit desconhecido

Sem restaurar a sessão e sem liberar a chave (getSession depois: IDLE).

```json
{
  "kind": "ERROR",
  "state": "IDLE",
  "text": "Não foi possível confirmar o resultado. Confira a tela de Finanças antes de enviar o pedido novamente."
}
```


## 6. Limites

Campo de data e quantidade seguem as regras de `parsers/write-body.parser.ts`. Datas aceitas: hoje, dd/mm (ano atual, sem saltar), dd/mm/aaaa. Outras expressões pedem data completa. Limite de dois anos vem do domínio (`firstDueLatestYmd`).
