# Brief de implementação, FRONTEND: item 3b2b (conta fixa e compra parcelada)

Para: subagente de desenvolvimento (haiku). Relatório final em estilo curto, sem enfeite. Código, comentários e textos de tela em português do Brasil, prosa normal.
Projeto: `/home/caminhao/coding/codeStage/Lumen`. Data: 2026-11-16. Trabalhe só em `frontend/`. NÃO toque em `backend/`.

O backend do 3b2b já está pronto e conferido. O chat precisa reconhecer dois novos tipos de rascunho (`RECURRING` e `INSTALLMENT`). O cartão genérico de `rows` do 3b1/3b2a já desenha título, linhas, avisos e botões: a mudança esperada é pequena (tipos, rótulos de campo pendente e testes). O 3b2a foi o mesmo padrão: veja o que ele mudou com `git show e7f48bb` (3 arquivos) e imite.

## Leia primeiro

1. `.superpowers/sdd/conversa-item-3b2b/contrato-tipos.md`: **fonte dos tipos e dos formatos**, com JSONs reais (conta fixa e parcelado completos, cada campo pendente, revisão por data passada, `DONE` com e sem aviso, erro de commit desconhecido). Também `duvidas.md` da mesma pasta.
2. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b2.md`, seções 4 e 5 (Conta fixa e Compra parcelada).
3. `frontend/src/app/core/models/conversation.models.ts` e `frontend/src/app/features/assistant/assistant-page/assistant-page.component.{ts,html,scss,spec.ts}` como estão hoje, e o brief do 3b2a: `.superpowers/sdd/conversa-item-3b2a/brief-frontend.md`.

## Mudanças permitidas

- `conversation.models.ts`: `DraftKind` ganha `RECURRING` e `INSTALLMENT`; `PendingField` ganha `installmentsTotal` e `firstDueDate`; `ReplyData` ganha `recurringTransactionId?: string` e `installmentPurchaseId?: string`. Nada além do que o contrato de tipos descreve.
- `assistant-page.component.ts`: rótulos de `PENDING_FIELD_LABELS`: `installmentsTotal` → "quantidade de parcelas", `firstDueDate` → "primeiro vencimento". Outra mudança só se um fluxo demonstrável do 3b2b exigir.
- `assistant-page.component.spec.ts`: os testes abaixo.
- `assistant-page.component.html` e `.scss`: somente se um teste ou captura real mostrar necessidade concreta. Reutilize `rows`, título, avisos e botões. Atenção ao rótulo "Lançado" no cartão de resposta: aparece para `DONE` de reserva e limite; para conta fixa e parcelado o texto deveria ser "Criado". Decida o menor ajuste (por exemplo, mostrar "Criado" quando `DONE` trouxer `recurringTransactionId`, `installmentPurchaseId`, `envelopeId` ou `goalId`, e "Lançado" para lançamentos), com teste. Se achar que isso extrapola, registre em `.superpowers/sdd/conversa-item-3b2b/duvidas-frontend.md` e não faça.

## Testes obrigatórios (`assistant-page.component.spec.ts`)

1. Conta fixa completa: título `Conta fixa`, linhas Descrição, Valor por vencimento, Frequência, Primeiro vencimento, Categoria e Forma de pagamento (`não informada`), avisos, botões Confirmar e Cancelar; sem "null" e sem campos de lançamento duplicados.
2. Parcelado completo: título `Compra parcelada`, linhas Total da compra, Quantidade, Valor por parcela, Última parcela, Primeiro vencimento; dois avisos com o mesmo rótulo "Aviso" aparecem os dois.
3. Coleta restaurada com `pendingField` de cada campo novo (`installmentsTotal` → "Falta informar: quantidade de parcelas.", `firstDueDate` → "Falta informar: primeiro vencimento."), valores ausentes como `a informar` e nenhum botão Confirmar.
4. Revisão por data passada: resposta `ASK_FIELD` com `draftVersion` maior, linha `Atenção` visível, sem botão Confirmar; a resposta seguinte (`CONFIRM_DRAFT`) com versão maior substitui o cartão e o próximo Confirmar envia exatamente o novo `draftId`/versão.
5. `DONE` com `recurringTransactionId` e `DONE` com `installmentPurchaseId`: sucesso sem depender de `data.card`, com e sem a linha de aviso de materialização pendente no texto.
6. `ERROR`/`IDLE` sem draft (commit desconhecido): some o cartão e os botões, sem "Tentar de novo".
7. Se mexer no rótulo "Lançado"/"Criado": teste dos dois casos. Regressão: lançamento, meta, aporte, reserva e limite continuam como antes; formato antigo sem `rows` também.

## Regras

- Turnos manuais continuam só em memória (nada em `history`, `localStorage`, `sessionStorage`, console ou `saveAssistantTurn`). Sem cores, fontes ou componentes novos; tema claro/escuro e 360 px como estão.
- Conflito entre o contrato de tipos e o que você precisa: registre em `duvidas-frontend.md` e pare.
- Sem commit, push, amend, reset, deploy, dependência npm nova, segredo em arquivo. NÃO rode `graphify` (o agente principal roda).

## Verificação (rode e cole a saída com os números reais desta execução)

Em `frontend/`: `npx ng test --watch=false --browsers=ChromeHeadlessCI` (referência: 259 antes) e `npm run build`. Integração real, capturas e dois usuários são da revisão seguinte.

## Relatório final (curto)

Arquivos alterados, comandos com números reais, decisões onde o brief era omisso, e o que você NÃO conseguiu verificar.
