# Brief: Finanças por conversa, item 3b1 (metas e aportes), FRONTEND

Para: subagente de desenvolvimento (haiku). Relatório final em estilo curto, sem enfeite. Código, comentários e textos de tela em português do Brasil, prosa normal.
Projeto: `/home/caminhao/coding/codeStage/Lumen`. Trabalhe só em `frontend/`. NÃO toque em `backend/`.

## Objetivo

O backend agora também cria rascunhos de **meta** e de **aporte**, além de lançamento. O cartão do rascunho na tela do Selah precisa desenhar qualquer um deles. A mudança é pequena e só no cartão do rascunho.

## Leia antes de escrever código (nesta ordem)

1. `.superpowers/sdd/conversa-item-3b1/contrato-tipos.md`: formato final e exato de `DraftView` e `PendingField`, com 4 JSONs reais. **É a fonte dos tipos.**
2. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b1.md`, seção 5 (o que o front muda) e seção 4 (tipos).
3. Como está hoje: `frontend/src/app/core/models/conversation.models.ts`, `frontend/src/app/features/assistant/assistant-page/assistant-page.component.{ts,html,scss,spec.ts}`. Veja o cartão manual (`assistant-manual`), a lista `assistant-draft` (`<dl>`), `PENDING_FIELD_LABELS`, `pendingFieldLabel`, `draftDateLabel`, `draftPaymentLabel` e o teste de restauração do rascunho.

## O que fazer

1. **Tipos** (`core/models/conversation.models.ts`), espelhando o backend:
   - `DraftKind = 'TRANSACTION' | 'GOAL' | 'CONTRIBUTION'`.
   - `DraftView` ganha `kind`, `title`, `rows: Array<{ label: string; value: string }>`; `amount` e `date` passam a `string | null`.
   - `PendingField` ganha `'title' | 'target' | 'goal'` (já tem `amount`, `description`, `category`).
   - `ReplyData`: acrescente `goalId?: string` e `envelopes?: Array<{ label: string; monthlyCents: number; availableCents: number; spentCents: number }>` e confirme que `totalCents?: number` existe.
2. **Cartão do rascunho** (`assistant-page.component.html/ts/scss`):
   - Se `draft.rows` existir e tiver itens: desenhe as linhas de `rows` (rótulo e valor) na `<dl>`, e use `draft.title` como título do bloco do rascunho (ex.: "Meta", "Aporte", "Lançamento").
   - Se `rows` não existir (resposta de backend antigo): mantenha o desenho atual com os campos antigos, tratando `amount` e `date` nulos sem quebrar (não mostre "null").
   - Botões Confirmar e Cancelar, `quickReplies`, restauração de sessão, tom de sucesso/erro: nada muda.
3. **Rótulos** de `PENDING_FIELD_LABELS`: `title` → "nome", `target` → "valor-alvo", `goal` → "meta" (os existentes ficam).
4. **Respostas de leitura `envelopes`**: nada a desenhar; o texto já vem pronto em `text`.
5. Acessibilidade e tema como estão: reuse as classes existentes, nenhuma cor nem fonte nova; funciona em tema claro, escuro e 360 px.

## Testes (obrigatórios, no `assistant-page.component.spec.ts`)

- Rascunho de meta (`kind: 'GOAL'`, `rows` Nome e Alvo) aparece com título "Meta", as duas linhas e os botões Confirmar e Cancelar.
- Rascunho de aporte (`kind: 'CONTRIBUTION'`, `rows` Meta, Valor, Data) aparece com título "Aporte" e as três linhas.
- Lançamento com `rows` mostra as linhas de `rows`, sem duplicar nada.
- Resposta sem `rows` (formato antigo) continua desenhando como antes.
- `amount: null` e `date: null` não mostram "null".
- Restauração de sessão com `pendingField: 'target'` mostra "Falta informar: valor-alvo." e sem botão Confirmar.
- Todos os testes que já existem continuam passando.

## Como verificar (rode e cole a saída resumida)

Dentro de `frontend/`:
1. `npx ng test --watch=false --browsers=ChromeHeadlessCI`
2. `npm run build`
Na raiz, ao final: `graphify update .` (um só, nunca em paralelo).

## Proibições

- Não fazer commit, push, amend, reset nem deploy. Deixe as mudanças na árvore.
- Não alterar `backend/`. Conflito entre o contrato de tipos e o que você precisa: escreva em `.superpowers/sdd/conversa-item-3b1/duvidas-frontend.md` e pare.
- Sem segredo em arquivo. Sem dependência npm nova. Não "melhorar" código fora do escopo.
- Turnos manuais continuam só em memória (nada em `history`, `localStorage` ou `saveAssistantTurn`).

## Relatório final (curto)

Arquivos alterados, saída resumida dos comandos, decisões onde o brief era omisso, e o que você NÃO conseguiu verificar (por exemplo, a tela em navegador real).
