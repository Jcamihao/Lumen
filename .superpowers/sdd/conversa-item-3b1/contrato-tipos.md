# Contrato de tipos do item 3b1 (backend para o frontend)

Data: 2026-11-15. Fonte: `backend/src/conversation/conversation.types.ts`. Este arquivo descreve o formato final entregue pelo backend. Quem implementa o cartão do rascunho lê isto e não precisa abrir o motor.

## 1. DraftView (formato final)

```ts
type DraftKind = 'TRANSACTION' | 'GOAL' | 'CONTRIBUTION';

interface DraftView {
  draftId: string;
  draftVersion: number;
  kind: DraftKind;                 // sessão antiga sem kind chega como 'TRANSACTION'
  title: string;                   // 'Lançamento' | 'Meta' | 'Aporte'
  rows: Array<{ label: string; value: string }>;   // sem valor nulo; "a informar" quando falta
  // Campos antigos. Para TRANSACTION vêm preenchidos; para GOAL e CONTRIBUTION ficam nulos (sem uso).
  type: 'INCOME' | 'EXPENSE';      // GOAL e CONTRIBUTION sempre 'EXPENSE'
  amount: string | null;           // MUDANÇA: era string; agora nulo em meta e aporte
  description: string | null;
  category: string | null;
  date: string | null;             // MUDANÇA: era string; agora nulo em meta e aporte. Formato 'AAAA-MM-DD'
  paymentMethod: 'PIX' | 'CREDIT' | 'DEBIT' | null;
  pendingField: PendingField | null;
}
```

Rótulos de `rows` por tipo:

| kind | rows (ordem) |
|---|---|
| TRANSACTION | Valor, Descrição, Categoria, Data (dd/mm/aaaa), Forma de pagamento |
| GOAL | Nome, Alvo ("sem alvo (cofrinho)" quando não há alvo; "a informar" enquanto não respondeu) |
| CONTRIBUTION | Meta ("Nome (R$ guardado de R$ alvo)" ou "Nome (R$ guardado guardados)" se sem alvo), Valor, Data (dd/mm/aaaa) |

Correção da revisão: `TRANSACTION` com data futura e `CONTRIBUTION` que conclui a meta acrescentam uma linha `Aviso` às linhas acima. Ela é necessária porque a tela substitui o texto completo de confirmação por uma chamada curta. Não há campo ou tipo novo; o cartão e a restauração desenham essa linha como qualquer outra.

Atenção: a Data de `rows` sai em dd/mm/aaaa também para lançamento. `DraftView.date` continua 'AAAA-MM-DD'. Quem desenha deve usar `rows`, não `date`.

## 2. PendingField (formato final)

```ts
type PendingField = 'amount' | 'description' | 'category' | 'title' | 'target' | 'goal';
```

| pendingField | kind | Pergunta do motor (`ASK_FIELD.text`) |
|---|---|---|
| `amount` | TRANSACTION, CONTRIBUTION | "Quanto foi?" (lançamento) / "Quanto quer guardar?" (aporte) |
| `description` | TRANSACTION | "Qual a descrição do lançamento?" |
| `category` | TRANSACTION | "Qual a categoria?" com opções numeradas |
| `title` | GOAL | "Qual o nome da meta? Ex.: viagem." |
| `target` | GOAL | "Qual o valor-alvo? Responda o valor ou "sem alvo"." |
| `goal` | CONTRIBUTION | "Qual meta? 1) X 2) Y." (opções numeradas, até 5) |

Rótulos de tela sugeridos (contrato 3b1, seção 5): `amount` "valor", `description` "descrição", `category` "categoria", `title` "nome", `target` "valor-alvo", `goal` "meta".

## 3. Rascunhos guardados (interno do motor, não vai para a tela)

```ts
interface GoalDraft { kind: 'GOAL'; title: string | null; targetCents: number | null; noTarget: boolean; pendingField: 'title' | 'target' | null }
interface ContributionDraft { kind: 'CONTRIBUTION'; goalId: string | null; goalTitle: string | null; amountCents: number | null; date: string; goalOptions: string[]; pendingField: 'amount' | 'goal' | null }
interface ExpenseOrIncomeDraft { kind?: 'TRANSACTION'; /* demais campos do item 2 */ }
```

## 4. ReplyData (campos novos, aditivos)

- `goalId?: string`: em `DONE` de meta criada e de aporte.
- `envelopes?: Array<{ label; monthlyCents; availableCents; spentCents }>`: em `INFO` da leitura `envelopes` (até 5). `availableCents` pode ser negativo.
- `totalCents`: em `envelopes`, é o total disponível das reservas ativas (reuso do campo, o mesmo que já servia para outras consultas).

## 5. Exemplos reais

Copiados de uma execução de teste (`EXEMPLOS` rodado sobre o motor com o banco fake do spec). Os `draftId` são aleatórios em cada execução.

### 5.1 Lançamento (`50 mercado`)

```json
{
  "draftId": "e3ccf94d-82d6-4638-a487-ebb42a0a17ce",
  "draftVersion": 1,
  "type": "EXPENSE",
  "amount": "R$ 50,00",
  "description": "mercado",
  "category": "Mercado",
  "date": "2026-11-15",
  "paymentMethod": null,
  "kind": "TRANSACTION",
  "title": "Lançamento",
  "pendingField": null,
  "rows": [
    {
      "label": "Valor",
      "value": "R$ 50,00"
    },
    {
      "label": "Descrição",
      "value": "mercado"
    },
    {
      "label": "Categoria",
      "value": "Mercado"
    },
    {
      "label": "Data",
      "value": "15/11/2026"
    },
    {
      "label": "Forma de pagamento",
      "value": "não informado"
    }
  ]
}
```

### 5.2 Meta (`criar meta viagem 3 mil`)

```json
{
  "draftId": "603f43d4-2f76-4750-a10d-a33594ba4b7b",
  "draftVersion": 1,
  "type": "EXPENSE",
  "amount": null,
  "description": null,
  "category": null,
  "date": null,
  "paymentMethod": null,
  "kind": "GOAL",
  "title": "Meta",
  "pendingField": null,
  "rows": [
    {
      "label": "Nome",
      "value": "viagem"
    },
    {
      "label": "Alvo",
      "value": "R$ 3.000,00"
    }
  ]
}
```

### 5.3 Aporte (`guardar 200 na viagem`, com a meta "Viagem" em 1.200,00 de 3.000,00)

```json
{
  "draftId": "3b23128b-1b84-4d04-974d-ea95f7a302bf",
  "draftVersion": 1,
  "type": "EXPENSE",
  "amount": null,
  "description": null,
  "category": null,
  "date": null,
  "paymentMethod": null,
  "kind": "CONTRIBUTION",
  "title": "Aporte",
  "pendingField": null,
  "rows": [
    {
      "label": "Meta",
      "value": "Viagem (R$ 1.200,00 de R$ 3.000,00)"
    },
    {
      "label": "Valor",
      "value": "R$ 200,00"
    },
    {
      "label": "Data",
      "value": "15/11/2026"
    }
  ]
}
```

### 5.4 Aporte aguardando valor (`guardar viagem`): `pendingField` = `amount`

```json
{
  "draftId": "48bf5c57-e9f9-476e-a33a-946e1bdad9d9",
  "draftVersion": 1,
  "type": "EXPENSE",
  "amount": null,
  "description": null,
  "category": null,
  "date": null,
  "paymentMethod": null,
  "kind": "CONTRIBUTION",
  "title": "Aporte",
  "pendingField": "amount",
  "rows": [
    {
      "label": "Meta",
      "value": "Viagem (R$ 1.200,00 de R$ 3.000,00)"
    },
    {
      "label": "Valor",
      "value": "a informar"
    },
    {
      "label": "Data",
      "value": "15/11/2026"
    }
  ]
}
```

## 6. Respostas que o frontend já recebe

- `ASK_FIELD`, `CONFIRM_DRAFT`: trazem `draft` (DraftView acima).
- `DONE`: `data.goalId` em meta e aporte; `data.transactionId` em lançamento.
- `ERROR`: sem `draft`. Recusa de limite do plano chega com a mensagem da exceção, já em pt-BR.
- `INFO` (leitura `envelopes`): `data.envelopes`.
