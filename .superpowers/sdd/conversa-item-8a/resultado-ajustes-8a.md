# Ajustes do 8a — decisões do dono de 2026-11-23 (feito pelo Qwen, sem subagentes)

## O que mudou

1. **Apagar confere `updatedAt`** (antes só a edição conferia): em `applyTransactionChange`, a checagem de conflito passou a valer para os dois caminhos, antes do `transactions.remove`. Se o lançamento mudou pela tela desde a prévia, recusa com `TX_REPLIES.changed` e nada é apagado. Vale para a palavra `apagar` digitada e para a ação explícita do cartão (`confirmDraft` com `delete: true`).
2. **TRANSFER fora do editar/apagar**: `toTxCandidate` (função única de elegibilidade) passou a exigir `row.type !== 'TRANSFER'`. Cobre de uma vez: busca (`searchTransactions`), lista numerada, escolha, checagem na aplicação e prévia do cartão. O texto `onlyNonEditable` passou a citar transferência.
3. **"apagar" sem termo repetido**: aceito como está, sem mudança de código (decisão 3).

## Mutantes (injetados um por vez, revertidos entre injeções)

| # | Mutante | Resultado |
|---|---|---|
| M1 | elegibilidade sem a linha de TRANSFER | MORTO (3 falhas: lista, busca só-transferência, aplicação) |
| M2 | checagem de conflito movida para depois do `remove` (só edição confere) | MORTO (2 falhas: apagar digitado e apagar pelo botão) |
| M3 | checagem de elegibilidade ignorada no DELETE | MORTO (3 falhas: transferência na aplicação + travas antigas do 8a-1) |

Nenhum sobrevivente.

## Testes

- Novos em `transaction-change.spec.ts` (describe "decisoes do dono de 2026-11-23..."): transferência fora da lista; busca que só casa com transferência cai na mensagem de tela; lançamento que virou transferência na aplicação não apaga; apagar com conflito de `updatedAt` (mensagem digitada); apagar pelo botão com conflito de `updatedAt`.
- O teste que travava o texto antigo de `onlyNonEditable` foi atualizado.

## Verificação (2026-11-23, worktree Lumen-item8a2)

- `tsc --noEmit` limpo; `nest build` ok.
- Jest inteiro: 64 suítes, 1813 testes verdes.
- `src/conversation`: 720 verdes em UTC, America/Sao_Paulo e Asia/Tokyo.
- `transaction-change` 15x seguidas: 107 verdes em todas.
- Frontend não foi tocado nesta fatia (karma 365 verdes já medido na revisão do 8a-2).
