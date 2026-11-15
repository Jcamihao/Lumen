# Finanças por conversa: contrato do item 3b1 (metas e aportes) e correção de "reserva"

Data: 2026-11-15
Status: contrato escrito para aprovação do dono. Nenhum código foi criado.

Item 3b1 da "Ordem de implementação" de `2026-11-14-assistente-manual-financas.md`. Reúne duas coisas que dependem do mesmo vocabulário:

- **Parte A: correção do 3a.** No app, "Reservas" são os **envelopes** (valor reservado todo mês, como "gasolina"), e não metas sem alvo. O 3a mapeou "reservas" para `goals` por engano (conferi o esquema, não a tela). Esta parte corrige.
- **Parte B: escrever metas.** Criar meta e fazer aporte, sempre com rascunho e confirmação.

Criar reserva (envelope), conta fixa, parcelado e limite do cartão ficam no 3b2.

Base: motor, tabelas e rotas dos itens 1 a 3a não mudam. **Sem tabela, migration, rota nem DTO de entrada novos.** Mexe no backend (`backend/src/conversation/`) e no frontend (só o cartão do rascunho, para mostrar rascunhos que não são lançamentos).

## 1. Parte A: reservas são envelopes

Vocabulário do app (verificado nas telas): "Reservas" = `Envelope` (`EnvelopesCard`, "Nova reserva"); "Metas" = `Goal`. O limite do plano Grátis também chama os envelopes de "reservas". Uma meta sem alvo (`targetAmount` nulo) aparece como "cofrinho" e continua em `goals`.

Mudanças:

| Intenção | Frases | Fonte |
|---|---|---|
| `goals` (já existe) | `minhas metas`, `metas` | `GoalsService.list`. **Remover** `minhas reservas`, `reservas`, `como esta minha reserva`. |
| `envelopes` (nova, leitura) | `minhas reservas`, `reservas`, `como esta minha reserva`, `envelopes` | `EnvelopesService.list(userId)` |

A regra de casamento é a mesma do 3a: a frase sozinha casa sempre; com palavras depois, só casa se forem no máximo 3 e sem `?`.

`envelopes`: mostra as reservas **ativas**, até 5, por nome. Cada linha: nome, valor mensal, disponível (`available`, o que sobra acumulado) e gasto (`spent`). Rodapé: total disponível. Sem nenhuma ativa: "Você ainda não tem reservas." Reservas pausadas viram o aviso "Você tem N reserva(s) pausada(s)." quando N > 0. `ReplyData` ganha `envelopes?: Array<{ label: string; monthlyCents: number; availableCents: number; spentCents: number }>`. Valores em centavos; `available` pode ser negativo (gastou mais que depositou) e deve aparecer com o sinal.

O efeito colateral de `EnvelopesService.list` (gera os depósitos mensais atrasados) é o mesmo de abrir a tela.

## 2. Parte B: decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | Escrever meta e aporte usa `GoalsService.create` e `GoalsService.contribute`. | Mesmas regras, limite de plano, notificação de meta concluída e lançamento de transferência que a tela. |
| D2 | O rascunho passa a ter tipos: `TRANSACTION` (o que já existe), `GOAL` e `CONTRIBUTION`. `session.intent` diz qual. | Uma só tabela e um só algoritmo de confirmação (item 1, seção 7). |
| D3 | A tela passa a desenhar o rascunho por **linhas genéricas** (`rows`), em vez de campos fixos de lançamento. | Evita uma tela nova por tipo de rascunho. |
| D4 | O limite de metas do plano é checado **ao abrir o rascunho**, não só ao confirmar. | O usuário não preenche tudo para descobrir no fim que não pode criar. |
| D5 | Erro 4xx na hora de gravar descarta o rascunho. Só erro inesperado o devolve. | Um rascunho que nunca poderá ser gravado (limite do plano, meta apagada) não deve voltar em loop. |
| D6 | Meta nova nasce **ativa**, sem data-alvo e sem aporte automático. | Esses campos se editam no app; o bot guarda só nome e alvo. |

## 3. Intenções de escrita

Ids fixos. Normalização igual ao matcher atual. Comandos curtos: até 6 palavras no total e sem `?`; pergunta longa vai ao Selah.

### `create_goal` (criar meta)

Frases: começam por `criar meta`, `nova meta` ou `criar cofrinho`. O resto é o corpo.

Corpo (`<nome>` e `<valor>`, nesta ordem de preferência):
1. Começa com valor: `3 mil viagem` → alvo R$ 3.000, nome "viagem".
2. Termina com valor de 1 ou 2 palavras que formam um valor completo: `viagem 3 mil`, `viagem 3000`.
3. Só nome: `viagem` → pergunta o alvo.
4. Vazio: pergunta o nome.

Campos do rascunho `GoalDraft`:

```ts
interface GoalDraft {
  kind: 'GOAL';
  title: string | null;         // 2 a 60 caracteres
  targetCents: number | null;   // null = sem alvo (cofrinho)
  noTarget: boolean;            // true quando o usuário respondeu "sem alvo"
  pendingField: 'title' | 'target' | null;
}
```

- Falta nome: pergunta "Qual o nome da meta? Ex.: viagem." (`pendingField: 'title'`).
- Falta alvo: pergunta "Qual o valor-alvo? Responda o valor ou "sem alvo"." (`pendingField: 'target'`). `sem alvo`, `nenhum` e `não` fecham como cofrinho. Valor inválido segue as mesmas regras e mensagens do parser de valores (`1,234` ambíguo pede reenvio).
- Nome igual ao de uma meta ativa do mesmo usuário: avisa "Você já tem uma meta ativa com esse nome." e não abre rascunho.
- Ao abrir o rascunho: `EntitlementsService.assertCanCreate(userId, 'goals')`. Se lançar `PlanLimitException`, responde `ERROR` com a mensagem da própria exceção (já em pt-BR, sem dado sensível) e não abre rascunho.
- Confirmação: "Rascunho de meta:\nNome: viagem\nAlvo: R$ 3.000,00\nResponda "confirmar" ou "cancelar"." (sem alvo: "Alvo: sem alvo (cofrinho)").
- Aplicar: `GoalsService.create(userId, { title, targetAmount })`, onde `targetAmount` é `targetCents / 100` ou ausente.
- `DONE`: "Meta criada: viagem, alvo R$ 3.000,00." / "Cofrinho criado: viagem." `data.goalId`.

### `contribute_goal` (aporte)

Frases: começam por `guardar`, `aportar`, `poupar`, `depositar`, `colocar` ou `aporte de`. Depois do verbo: valor, conectores opcionais (`na`, `no`, `em`, `para`, `pra`, `a`, `meta`, `cofrinho`, `reserva` não entra) e o nome da meta.

Exemplos: `guardar 200 na viagem`, `aportar 200 meta viagem`, `colocar 100 na meta casa`, `aporte de 50 viagem`.

```ts
interface ContributionDraft {
  kind: 'CONTRIBUTION';
  goalId: string | null;
  goalTitle: string | null;       // para mostrar; o id é a fonte da verdade
  amountCents: number | null;
  date: string;                   // 'YYYY-MM-DD' no fuso do usuário (hoje)
  goalOptions: string[];          // ids oferecidos quando a escolha é ambígua (máx. 5)
  pendingField: 'amount' | 'goal' | null;
}
```

- A meta é buscada entre as metas **ativas** do usuário (`GoalsService.list`), por título sem acento e sem caixa: igualdade primeiro, depois prefixo, depois "contém". Uma só candidata: usa. Várias: pergunta com opções numeradas (até 5), como a categoria. Nenhuma: responde "Não achei uma meta ativa com esse nome." e lista até 5 títulos; não abre rascunho.
- Sem nome de meta e com **uma única** meta ativa: usa essa meta (o rascunho mostra qual). Com várias: pergunta qual (opções numeradas). Com nenhuma: "Você não tem metas ativas."
- Sem valor (`guardar viagem`): pergunta "Quanto quer guardar?" (`pendingField: 'amount'`).
- Valor ≤ 0 ou ambíguo: mesmas regras e mensagens do parser.
- Confirmação: "Rascunho de aporte:\nMeta: Viagem (R$ 1.200,00 de R$ 3.000,00)\nValor: R$ 200,00\nData: 15/11/2026\nResponda "confirmar" ou "cancelar"." Se `atual + aporte >= alvo` (meta com alvo), acrescenta a linha "Este aporte conclui a meta.".
- Aplicar: `GoalsService.contribute(userId, goalId, { amount, date: ${date}T00:00:00.000Z, createTransaction: true })`. Isso cria a transferência de aporte, soma ao valor atual e conclui a meta se bater o alvo.
- `DONE`: "Aporte feito: R$ 200,00 em Viagem. Agora R$ 1.400,00 de R$ 3.000,00 (46%)." Meta concluída: acrescenta "Meta concluída." Cofrinho sem alvo: "Agora R$ X guardados." `data.goalId`.
- A meta é revalidada ao confirmar (o serviço procura por `id + userId`): meta apagada ou de outra conta resulta em 404 do serviço (ver D5).

### Regras comuns às duas

- **Estado e prazos**: iguais aos do item 1 (coleta 15 min, confirmação 5 min). `unrecognized` não se aplica: entrada que casa a frase é sempre tratada pelo bot.
- **Durante um rascunho em coleta**, outro comando de escrita não substitui o rascunho em silêncio (mesma regra de hoje); leituras respondem e mantêm o rascunho; um número responde a pergunta pendente (valor ou opção).
- **Confirmar** segue o algoritmo da seção 7 do contrato do item 1 (reivindicar, registrar `appliedKey`, aplicar). `resultRef` do evento = `goalId`.
- **Falha ao gravar** (D5): `PlanLimitException` → `ERROR` com a mensagem dela, rascunho descartado. Outro `HttpException` com status < 500 (meta não encontrada, dado inválido) → `ERROR` com "Não foi possível gravar. A meta pode ter sido removida.", rascunho descartado. Qualquer outro erro → comportamento atual (restaura o rascunho).
- **Log**: só o id da intenção e `error.name`; nunca mensagem, valor ou nome de meta.

## 4. Tipos e resposta

`ExpenseOrIncomeDraft` ganha `kind: 'TRANSACTION'` (ausente em sessões antigas = `TRANSACTION`). `ConversationSession.draft` guarda `GoalDraft | ContributionDraft | ExpenseOrIncomeDraft`; o motor decide pelo campo `kind`.

`PendingField` passa a incluir `'title' | 'target' | 'goal'` (além de `'amount' | 'description' | 'category'`).

`DraftView` ganha dois campos aditivos e continua com os atuais:

```ts
kind: 'TRANSACTION' | 'GOAL' | 'CONTRIBUTION';
title: string;                              // "Lançamento", "Meta" ou "Aporte"
rows: Array<{ label: string; value: string }>;
```

`rows` lista, já formatados e sem valores nulos: lançamento (Valor, Descrição, Categoria, Data, Forma de pagamento), meta (Nome, Alvo), aporte (Meta, Valor, Data). Valor não informado ainda aparece como "a informar". Campos antigos de `DraftView` seguem preenchidos para lançamento (compatibilidade); para meta e aporte ficam com `type: 'EXPENSE'` e demais campos nulos, sem uso.

`ReplyData` ganha `goalId?: string`, `envelopes?: [...]` (Parte A).

## 5. Frontend (só o cartão do rascunho)

Em `frontend/src/app/features/assistant/assistant-page/`:
- O cartão do rascunho desenha `draft.rows` (rótulo e valor) quando existir; sem `rows`, usa os campos antigos. Cabeçalho do bloco: `draft.title`.
- `PENDING_FIELD_LABELS` ganha `title` ("nome"), `target` ("valor-alvo") e `goal` ("meta").
- Tipos em `core/models/conversation.models.ts` espelham `DraftView` e `PendingField`.
- Nada mais muda: botões Confirmar/Cancelar, restauração de sessão e `quickReplies` já servem.
- Testes: cartão com `rows` de meta e de aporte; "Falta informar: valor-alvo." na restauração.

## 6. Segurança e isolamento

- `userId` só do argumento do motor; nunca vem do texto. `goalId` do rascunho foi resolvido a partir de `GoalsService.list(userId)`, e `contribute` revalida `id + userId` ao confirmar.
- Confirmar rascunho de outra conta continua falhando antes de qualquer serviço (404 / `null`), como nos itens anteriores.
- Nada de dado de uma conta aparece em resposta de outra; títulos de meta são texto livre do dono e vão para a resposta truncados em 60 caracteres.
- Nenhuma escrita acontece sem `confirmar`. Nenhuma escrita acontece em leitura.

## 7. Testes exigidos

Backend:
- Matcher: cada frase de `create_goal` e `contribute_goal`; as sugestões do Selah e perguntas longas ("quanto devo guardar por mês?", "qual meta merece aporte agora?", "criar uma meta para o ano que vem é boa ideia?") **não** casam; `reservas` e `minhas reservas` casam `envelopes` e não `goals`.
- `envelopes`: vazio, com itens, mais de 5, pausadas, disponível negativo, isolamento A/B.
- `create_goal`: nome e alvo de uma vez; só nome pergunta o alvo; `sem alvo`; nome vazio pergunta; nome duplicado ativo recusa; limite do plano recusa **ao abrir** e **ao confirmar** (simule o limite surgindo entre os dois); `3 mil`, `3000`, `1,234` ambíguo.
- `contribute_goal`: meta única automática; várias pedem opção; nenhuma recusa listando; sem valor pergunta; conclusão da meta mostra a linha de aviso e o `DONE` diz "Meta concluída"; cofrinho sem alvo; meta apagada entre rascunho e confirmação descarta com mensagem.
- Confirmação: duas vezes e em paralelo gravam **uma** vez (`GoalsService.create` e `contribute` chamados uma vez); versão velha rejeitada; expiração 15/5 min.
- Isolamento A/B: B não confirma nem cancela rascunho de A; aporte do bot de A nunca chama `contribute` com id de meta de B; o `userId` repassado a `create` e `contribute` é o do motor. **Mutantes obrigatórios:** repassar outro `userId` a `create`; idem a `contribute`; remover o filtro de meta ativa; remover a revalidação por `userId` na busca da meta.
- Falha inesperada em `create` ou `contribute` restaura o rascunho; `PlanLimitException` e 404 descartam.
- Suíte inteira verde em `TZ=UTC`, `America/Sao_Paulo`, `Asia/Tokyo`.

Frontend: seção 5.

Ponta a ponta (revisor, com backend real e Chrome headless): criar meta, ver o limite do plano Grátis recusar a terceira, aportar, concluir uma meta, cancelar, recarregar com rascunho de meta aberto, dois usuários.

## 8. Arquivos

Backend, só em `backend/src/conversation/`: `parsers/intent.matcher.ts` (+spec), `conversation.service.ts` (+spec), `replies.ts`, `conversation.types.ts`, `conversation.module.ts` (importa `EnvelopesModule` e `BillingModule` se `EntitlementsService` não vier por `GoalsModule`; conferir).
Frontend: `core/models/conversation.models.ts`, `features/assistant/assistant-page/assistant-page.component.{ts,html,scss,spec.ts}`.

## 9. Decisões abertas do dono

1. Verbos de aporte: `guardar`, `aportar`, `poupar`, `depositar`, `colocar`, `aporte de`. Falta algum que você usaria?
2. Meta nasce sem data-alvo no bot (D6). Quer uma frase para definir prazo ("até dezembro")? Padrão: não, edita-se no app.
3. Aporte sempre cria a transferência no extrato (`createTransaction: true`), como o app faz por padrão. Manter?

## 10. Fora deste contrato

Criar reserva (envelope), conta fixa, parcelado e limite do cartão (3b2). Retirar da meta (`withdraw`), editar, pausar e excluir meta (item 8). Nota fiscal (4). WhatsApp (5).
