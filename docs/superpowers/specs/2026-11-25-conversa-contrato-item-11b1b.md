# Contrato da fatia 11b-1b — cartões compartilhados (backend)

Data: 2026-11-25. Guarda-chuva: `2026-11-25-conversa-contrato-item-11b.md` (APROVADO pelo
dono; seção 8 e decisão 4/5/1 dele). O dono mandou seguir ("vai"), então — como na 10 e na
9c-2 — o contrato desta fatia é decisão da sessão documentada, com veto do dono na volta.
Escopo: **só backend** (app = 11b-2; bot/insights/LGPD = 11b-3).

Estado da arte que a fatia encosta: `AccessScopeService` é o único ponto de decisão de
leitura; `lock.ts` fixa a ordem de escrita (linha do autor → membership → itens);
`shared-view.ts` define como o parceiro enxerga item alheio (`isShared`/`isMine`/
`sharedByName`, primeiro nome só); ciclo lê datas do cartão (9c-2) e teto histórico em
`CreditCycleCeiling(cardId, closingDate)`.

## Decisões

- **D1 — coluna.** `CreditCard.sharedGroupOwnerId String?` (FK `User`, SET NULL, índice),
  mesma convenção de `Transaction`/`FinanceCategory`. Migration à mão
  `20261125140000_carteira_compartilhada_cartoes` (só `ADD COLUMN`/`CREATE INDEX`/FK — os
  DOIS índices únicos parciais de `CreditCard` não são tocados). SELECT de paranoía de
  deploy idêntico ao da 9c-2/11b-1a (marcas órfãs de grupo).
- **D2 — marcar cartão.** `PATCH /credit-cards/:id/sharing` `{shared: boolean}`, **só o
  autor**, lock na ordem da casa, exige grupo ativo com plano SHARED (erro
  `SHARING_NEEDS_ACTIVE_GROUP`), idempotente, recibo `SharingReceipt`. Cartão arquivado
  não pode ser compartilhado (409). **Desmarcar o cartão desmarca também os lançamentos
  de outro membro que apontavam para ele** (eles só eram visíveis por causa do cartão —
  privacidade primeiro).
- **D3 — listagem.** `GET /credit-cards?scope=mine|shared|all`, mesma validação dos
  lançamentos (`GROUP_REQUIRED` 400 sem grupo, `PLAN_REQUIRED` 403 sem plano SHARED).
  Cartão alheio aparece só compartilhado **e não arquivado**, com as flags de
  `shared-view.ts`. Cartões próprios ganham `isShared` (o campo novo não muda o shape
  para o app de hoje: campos a mais, nada removido).
- **D4 — teto editável por qualquer um** (seção 8 do contrato 11b):
  `PUT /credit-cards/:id/ceiling` e `PUT /credit-cycle/ceiling` aceitam cartão
  compartilhado do parceiro; a linha de `CreditCycleCeiling` continua com o `userId` do
  **dono do cartão** (a tabela já é assim; "quem escreveu" não é auditado — v1). O bot
  não muda nesta fatia (11b-3).
- **D5 — ciclo é do grupo.** `current`/`summary` computam com cartão próprios **+ cartões
  compartilhados do parceiro** (grupo ativo): `totalCents` é o total do grupo; `byCard`
  tem uma linha por cartão (cada cartão mantém fechamento/vencimento e
  `countAllPayments` próprios), com as flags de compartilhamento na linha. `current` sem
  `cardId` continua usando as datas do cartão padrão de quem lê.
- **D6 — lançamentos no cartão do parceiro.** `cardId` de cartão compartilhado do
  parceiro passa a valer em create/update; o lançamento nasce **compartilhado por
  construção** (é o livro dele — decisão 1 do contrato: sem compartilhar, ele nem vê o
  lançamento). Sem o cartão compartilhado, o `cardId` alheio continua inválido (400).
- **D7 — resto só do autor.** Editar nome/datas/arquivar/desarquivar/set padrão/excluir
  cartão continuam autor-only (404 para o parceiro — uniforme com o resto da casa).
  Parceiro mexe só no teto.
- **D8 — cascata de saída.** Saída/remoção de membro desmarca também os cartões do
  membro (extensão do desmarcar da 11b-1a).

## O que NÃO entra nesta fatia
App (11b-2), bot/insights/LGPD/relatórios (11b-3), compartilhar categorias de orçamento
compartilhado, trocar quem é o "cartão padrão" do grupo (não existe padrão do grupo).
